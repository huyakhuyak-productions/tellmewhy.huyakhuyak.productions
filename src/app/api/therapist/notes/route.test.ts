import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversation } from "@/lib/conversations";
import { grantConversation } from "@/lib/sharing";
import { acceptInvite, createInvite } from "@/lib/therapist-links";
import { therapistWriteRateLimiter } from "@/lib/rate-limit";
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

function jsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/therapist/notes", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await POST(jsonRequest({ clientId: "x", kind: "private", body: "note" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await POST(jsonRequest({ clientId: "x", kind: "private", body: "note" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 for an invalid kind", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ clientId: "x", kind: "bogus", body: "note" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty body", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ clientId: "x", kind: "private", body: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a body over the 4000-character cap", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ clientId: "x", kind: "private", body: "a".repeat(4001) }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a therapist with no active link to the given clientId", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ clientId: `test-${randomUUID()}`, kind: "private", body: "note" }));
    expect(res.status).toBe(404);
  });

  it("creates a client-scoped note for a linked client", async () => {
    const clientId = `test-${randomUUID()}`;
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ clientId, kind: "private", body: "Working on grounding techniques" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toEqual(expect.any(String));
    expect(body.version).toBe(1);
  });

  it("returns 404 when the passed clientId doesn't match the gated conversation's actual client", async () => {
    const clientId = await seedUser();
    const otherClientId = `test-${randomUUID()}`;
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(
      jsonRequest({ clientId: otherClientId, conversationId: conv.id, kind: "private", body: "note" }),
    );
    expect(res.status).toBe(404);
  });

  // Runs last in this file: it drains the shared in-memory bucket for
  // `therapistId`, which would make an earlier test in this file see a 429 if
  // it ran after this one. Exhausting via the limiter's own API (rather than
  // via the route) ensures the test doesn't depend on slow network conditions.
  // See src/lib/rate-limit.test.ts for the limiter's own consume/refill coverage.
  it("returns 429 once the per-therapist write bucket is exhausted", async () => {
    const therapistId = `test-${randomUUID()}`;
    for (let i = 0; i < 20; i++) therapistWriteRateLimiter.consume(therapistId);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ clientId: "x", kind: "private", body: "note" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "A gentle pace — your work is saved as you go" });
  });
});
