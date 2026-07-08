import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversation } from "@/lib/conversations";
import { grantConversation } from "@/lib/sharing";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

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
    const clientId = `test-${randomUUID()}`;
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
});
