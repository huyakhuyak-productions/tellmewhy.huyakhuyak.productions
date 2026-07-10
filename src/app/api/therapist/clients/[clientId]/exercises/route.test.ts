import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptInvite, createInvite } from "@/lib/therapist-links";
import { therapistWriteRateLimiter } from "@/lib/rate-limit";

type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = null;

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET, POST } from "./route";

afterEach(() => {
  session = null;
});

function ctxFor(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function linkedPair() {
  const clientId = `test-${randomUUID()}`;
  const therapistId = `test-${randomUUID()}`;
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  return { clientId, therapistId };
}

describe("GET /api/therapist/clients/[clientId]/exercises", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 for an invalid clientId", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(""));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a client not linked to this therapist", async () => {
    const therapistId = `test-${randomUUID()}`;
    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("lists the assignments for a linked client", async () => {
    const { clientId, therapistId } = await linkedPair();

    session = { user: { id: therapistId, role: "therapist" } };
    const assignRes = await POST(jsonRequest({ type: "thought_record", instruction: "Notice one thought" }), ctxFor(clientId));
    expect(assignRes.status).toBe(201);

    const res = await GET(new Request("http://localhost"), ctxFor(clientId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].instruction).toBe("Notice one thought");
  });
});

describe("POST /api/therapist/clients/[clientId]/exercises", () => {
  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await POST(jsonRequest({ type: "thought_record", instruction: "hi" }), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed body", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ type: "wrong", instruction: "hi" }), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty instruction", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ type: "thought_record", instruction: "" }), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an instruction over the 2000-character cap", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await POST(jsonRequest({ type: "thought_record", instruction: "a".repeat(2001) }), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(400);
  });

  it("returns 404 when assigning to a client not linked to this therapist", async () => {
    const therapistId = `test-${randomUUID()}`;
    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ type: "thought_record", instruction: "hi" }), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("assigns an exercise to a linked client and returns 201 with its id", async () => {
    const { clientId, therapistId } = await linkedPair();

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ type: "thought_record", instruction: "Notice one thought" }), ctxFor(clientId));
    expect(res.status).toBe(201);
    // Exact shape: an id and nothing else — an extra field appearing here must
    // be a deliberate, tested contract change, never a silent leak.
    expect(await res.json()).toEqual({ id: expect.any(String) });
  });

  // The drained bucket belongs to a fresh per-test therapist id, so no other
  // test in this file can observe the exhaustion. Draining via the limiter's
  // own API (rather than 20 route calls) keeps the test fast; see
  // src/lib/rate-limit.test.ts for the limiter's own consume/refill coverage.
  it("returns 429 once the per-therapist write bucket is exhausted", async () => {
    const therapistId = `test-${randomUUID()}`;
    for (let i = 0; i < 20; i++) therapistWriteRateLimiter.consume(therapistId);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ type: "thought_record", instruction: "hi" }), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "A gentle pace — your work is saved as you go" });
  });
});
