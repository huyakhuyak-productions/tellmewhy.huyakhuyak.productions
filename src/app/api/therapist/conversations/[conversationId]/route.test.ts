import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversation, saveMessage } from "@/lib/conversations";
import { grantConversation, revokeGrant } from "@/lib/sharing";
import { advanceReviewMarker } from "@/lib/therapist-access";
import { acceptInvite, createInvite } from "@/lib/therapist-links";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

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
afterEach(cleanupSeededUsers);

function ctxFor(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) };
}

describe("GET /api/therapist/conversations/[conversationId]", () => {
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
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const conv = await createConversation(clientId, "Never shared");

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(conv.id));
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
    const res = await GET(new Request("http://localhost"), ctxFor(conv.id));
    expect(res.status).toBe(404);
  });

  it("returns decrypted messages with no marker when nothing has been reviewed yet", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);
    await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hello" });

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(conv.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].text).toBe("hello");
    expect(body.marker).toBeNull();
  });

  it("returns the therapist's own review marker for this conversation", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared with marker");
    await grantConversation(clientId, conv.id);
    const msg = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });
    await advanceReviewMarker(therapistId, conv.id, msg.id);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(conv.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.marker.messageId).toBe(msg.id);
  });
});
