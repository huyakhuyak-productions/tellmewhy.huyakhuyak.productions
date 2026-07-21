import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversation, loadMessages } from "@/lib/conversations";
import { grantConversation, revokeGrant } from "@/lib/sharing";
import { acceptInvite, createInvite } from "@/lib/therapist-links";
import chatRateLimiter, { therapistWriteRateLimiter } from "@/lib/rate-limit";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = null;

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST } from "./route";

afterEach(() => {
  session = null;
});
afterEach(cleanupSeededUsers);

function ctxFor(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/therapist/conversations/[conversationId]/intervention", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await POST(jsonRequest({ text: "hi" }), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await POST(jsonRequest({ text: "hi" }), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
  });

  it("returns 400 for an empty text body", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ text: "" }), ctxFor(randomUUID()));
    expect(res.status).toBe(400);
  });

  it("returns 400 for text over the 8000-character cap", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ text: "a".repeat(8001) }), ctxFor(randomUUID()));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a therapist without a grant on this conversation", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const conv = await createConversation(clientId, "Never shared");

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ text: "hi" }), ctxFor(conv.id));
    expect(res.status).toBe(404);
  });

  it("returns 404 once the grant has been revoked", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Revoked");
    await grantConversation(clientId, conv.id);
    await revokeGrant(clientId, conv.id);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ text: "hi" }), ctxFor(conv.id));
    expect(res.status).toBe(404);
  });

  it("appends the intervention as a therapist message attributed to the caller", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ text: "You're doing great." }), ctxFor(conv.id));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toEqual(expect.any(String));

    const messages = await loadMessages(conv.id, clientId);
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe("therapist");
    expect(messages[0].text).toBe("You're doing great.");
    expect(messages[0].authorId).toBe(therapistId);
  });

  // Runs last in this file: it drains the shared in-memory bucket for
  // `therapistId`, which would make an earlier test in this file see a 429 if
  // it ran after this one. Exhausting via the limiter's own API (rather than
  // via the route) ensures the test doesn't depend on slow network conditions,
  // and isolates this test's logic from the internals of sendIntervention.
  // See src/lib/rate-limit.test.ts for the limiter's own consume/refill coverage.
  it("returns 429 once the per-therapist write bucket is exhausted", async () => {
    const therapistId = `test-${randomUUID()}`;
    for (let i = 0; i < 20; i++) therapistWriteRateLimiter.consume(therapistId);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ text: "hi" }), ctxFor(randomUUID()));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "A gentle pace — your work is saved as you go" });
  });

  it("therapistWriteRateLimiter isolation: draining it does not affect chatRateLimiter", async () => {
    const therapistId = `test-${randomUUID()}`;
    for (let i = 0; i < 20; i++) therapistWriteRateLimiter.consume(therapistId);
    // chatRateLimiter should still have tokens available
    expect(chatRateLimiter.consume(therapistId)).toBe(true);
  });
});
