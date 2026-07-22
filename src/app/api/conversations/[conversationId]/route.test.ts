import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createConversation, listConversations, listHiddenConversations } from "@/lib/conversations";
import { shredUserKey } from "@/lib/crypto/user-keys";
import chatRateLimiter, { conversationMutateRateLimiter } from "@/lib/rate-limit";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PATCH } from "./route";

beforeAll(async () => {
  await seedUser(userId);
});
afterAll(cleanupSeededUsers);

afterEach(() => {
  session = { user: { id: userId } };
});

function patchRequest(conversationId: string, body: unknown) {
  const req = new Request(`http://localhost/api/conversations/${conversationId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ conversationId }) });
}

describe("PATCH /api/conversations/[conversationId] — hide and restore", () => {
  it("hides a conversation from the client's own list, then restores it", async () => {
    const conv = await createConversation(userId, "Hide me");

    const hide = await patchRequest(conv.id, { hidden: true });
    expect(hide.status).toBe(204);
    expect((await listConversations(userId)).map((c) => c.id)).not.toContain(conv.id);
    expect((await listHiddenConversations(userId)).map((c) => c.id)).toContain(conv.id);

    const restore = await patchRequest(conv.id, { hidden: false });
    expect(restore.status).toBe(204);
    expect((await listConversations(userId)).map((c) => c.id)).toContain(conv.id);
  });

  it("returns 404 (never a hint) hiding a conversation owned by someone else", async () => {
    const foreign = await createConversation(await seedUser(), "Not yours");
    const res = await patchRequest(foreign.id, { hidden: true });
    expect(res.status).toBe(404);
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await patchRequest(randomUUID(), { hidden: true });
    expect(res.status).toBe(401);
  });

  // Stale-session shape: the user deleted their account (key tombstoned) but a
  // device still holds a valid session cookie. Renaming a conversation needs
  // their own DEK, which no longer exists — the answer must be the uniform 404,
  // never a 500 that betrays a shredded key.
  it("returns the uniform 404 when the caller's own key was shredded (stale session)", async () => {
    const ghostId = await seedUser();
    session = { user: { id: ghostId } };
    const conv = await createConversation(ghostId, "Written before deletion");
    await shredUserKey(ghostId);

    const res = await patchRequest(conv.id, { title: "rename after death" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  // The mutate bucket is its own instance with its own namespace — draining
  // it must never throttle the (separate) chat-send bucket.
  it("keeps the mutate bucket isolated from the chat bucket", async () => {
    for (let i = 0; i < 30; i++) conversationMutateRateLimiter.consume(userId);
    expect(conversationMutateRateLimiter.consume(userId)).toBe(false);
    expect(chatRateLimiter.consume(userId)).toBe(true);
  });

  // Runs last: it drains the shared in-memory mutate bucket for `userId`,
  // which would make an earlier PATCH test in this file see a 429 if it ran
  // after this one. Exhausting via the limiter's own API keeps it fast and
  // deterministic — see src/lib/rate-limit.test.ts for consume/refill coverage.
  it("returns 429 once the per-user mutate bucket is exhausted", async () => {
    const conv = await createConversation(userId, "One too many");
    for (let i = 0; i < 30; i++) conversationMutateRateLimiter.consume(userId);

    const res = await patchRequest(conv.id, { hidden: true });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "A gentle pace — try again in a moment" });
  });
});
