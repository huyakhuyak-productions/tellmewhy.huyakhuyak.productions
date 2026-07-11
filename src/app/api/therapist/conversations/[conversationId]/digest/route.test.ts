import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversation } from "@/lib/conversations";
import { digestReadRateLimiter } from "@/lib/rate-limit";
import { grantConversation } from "@/lib/sharing";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = null;

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET } from "./route";

afterEach(() => {
  session = null;
});

function ctxFor(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) };
}

describe("GET /api/therapist/conversations/[conversationId]/digest", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await GET(new Request("http://localhost"), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await GET(new Request("http://localhost"), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 for a non-uuid conversationId", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a therapist with no grant on this conversation", async () => {
    const clientId = `test-${randomUUID()}`;
    const therapistId = `test-${randomUUID()}`;
    const conv = await createConversation(clientId, "Never shared");

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(conv.id));
    expect(res.status).toBe(404);
  });

  it("returns 429 once the per-therapist digest rate limit is exhausted", async () => {
    const therapistId = `test-${randomUUID()}`;
    session = { user: { id: therapistId, role: "therapist" } };
    // Drain this therapist's own bucket via the limiter's API (isolated from
    // every other test's therapistId) — the check runs before param parsing, so
    // any ctx id reaches it.
    for (let i = 0; i < 35; i++) digestReadRateLimiter.consume(therapistId);

    const res = await GET(new Request("http://localhost"), ctxFor(randomUUID()));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "A gentle pace — the digest is a moment away" });
  });

  it("returns 200 with a null digest for a granted-but-empty conversation", async () => {
    const clientId = `test-${randomUUID()}`;
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared, no messages");
    await grantConversation(clientId, conv.id);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(conv.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ digest: null });
  });
});
