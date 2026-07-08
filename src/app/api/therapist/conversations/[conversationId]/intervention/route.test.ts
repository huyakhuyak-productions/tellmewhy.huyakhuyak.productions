import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversation, loadMessages } from "@/lib/conversations";
import { grantConversation, revokeGrant } from "@/lib/sharing";
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
    const clientId = `test-${randomUUID()}`;
    const therapistId = `test-${randomUUID()}`;
    const conv = await createConversation(clientId, "Never shared");

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await POST(jsonRequest({ text: "hi" }), ctxFor(conv.id));
    expect(res.status).toBe(404);
  });

  it("returns 404 once the grant has been revoked", async () => {
    const clientId = `test-${randomUUID()}`;
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
    const clientId = `test-${randomUUID()}`;
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
});
