import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { reviewMarkers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createConversation, saveMessage } from "@/lib/conversations";
import { grantConversation, revokeGrant } from "@/lib/sharing";
import { acceptInvite, createInvite } from "@/lib/therapist-links";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = null;

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT } from "./route";

afterEach(() => {
  session = null;
});
afterEach(cleanupSeededUsers);

function ctxFor(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/therapist/conversations/[conversationId]/review-marker", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await PUT(jsonRequest({ messageId: randomUUID() }), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await PUT(jsonRequest({ messageId: randomUUID() }), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-uuid messageId", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await PUT(jsonRequest({ messageId: "not-a-uuid" }), ctxFor(randomUUID()));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a therapist without a grant on this conversation", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const conv = await createConversation(clientId, "Never shared");
    const msg = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await PUT(jsonRequest({ messageId: msg.id }), ctxFor(conv.id));
    expect(res.status).toBe(404);
  });

  it("returns 404 once the grant has been revoked", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Revoked");
    await grantConversation(clientId, conv.id);
    const msg = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });
    await revokeGrant(clientId, conv.id);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await PUT(jsonRequest({ messageId: msg.id }), ctxFor(conv.id));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a message belonging to a different conversation", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "A");
    const other = await createConversation(clientId, "B");
    await grantConversation(clientId, conv.id);
    await grantConversation(clientId, other.id);
    const foreignMsg = await saveMessage({ conversationId: other.id, userId: clientId, sender: "client", text: "wrong" });

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await PUT(jsonRequest({ messageId: foreignMsg.id }), ctxFor(conv.id));
    expect(res.status).toBe(404);
  });

  it("advances the review marker for a granted conversation", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);
    const msg = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await PUT(jsonRequest({ messageId: msg.id }), ctxFor(conv.id));
    expect(res.status).toBe(204);

    const [row] = await db
      .select()
      .from(reviewMarkers)
      .where(and(eq(reviewMarkers.linkId, linkId), eq(reviewMarkers.conversationId, conv.id)));
    expect(row?.lastReviewedMessageId).toBe(msg.id);
  });
});
