import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
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

import { GET } from "./route";

afterEach(() => {
  session = null;
});
afterEach(cleanupSeededUsers);

describe("GET /api/therapist/attention", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns an empty list when nothing crisis/flagged is granted", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("surfaces a crisis message from a granted conversation, never an ungranted one", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const granted = await createConversation(clientId, "Granted");
    await grantConversation(clientId, granted.id);
    const crisisMsg = await saveMessage({
      conversationId: granted.id,
      userId: clientId,
      sender: "client",
      text: "crisis text",
      riskLevel: "crisis",
    });
    const ungranted = await createConversation(clientId, "Ungranted");
    await saveMessage({
      conversationId: ungranted.id,
      userId: clientId,
      sender: "client",
      text: "hidden crisis",
      riskLevel: "crisis",
    });

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((i: { messageId: string }) => i.messageId)).toEqual([crisisMsg.id]);
    expect(JSON.stringify(body)).not.toContain("hidden crisis");
  });

  it("stops surfacing a crisis message once its grant is revoked", async () => {
    const clientId = await seedUser();
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Revoked crisis");
    await grantConversation(clientId, conv.id);
    await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "will be hidden", riskLevel: "crisis" });

    session = { user: { id: therapistId, role: "therapist" } };
    expect(await (await GET()).json()).toHaveLength(1);

    await revokeGrant(clientId, conv.id);
    expect(await (await GET()).json()).toEqual([]);
  });
});
