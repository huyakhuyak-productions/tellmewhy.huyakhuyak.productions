import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversation } from "@/lib/conversations";
import { getGrantStateForClient } from "@/lib/sharing";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { DELETE, POST } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});

function shareRequest(method: "POST" | "DELETE", conversationId: string) {
  const req = new Request(`http://localhost/api/conversations/${conversationId}/share`, { method });
  const ctx = { params: Promise.resolve({ conversationId }) };
  return method === "POST" ? POST(req, ctx) : DELETE(req, ctx);
}

// Each test that needs an active therapist link uses its own fresh client
// id — the one-active-link-per-client rule (therapist-links.ts) means a
// shared client id across tests would collide the moment a second test
// tries to create its own link for the "same" client.
async function withActiveLink(): Promise<{ clientId: string }> {
  const clientId = `test-${randomUUID()}`;
  const therapistId = `test-${randomUUID()}`;
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  return { clientId };
}

describe("POST/DELETE /api/conversations/[conversationId]/share", () => {
  it("grants a conversation the caller owns to their active therapist link", async () => {
    const { clientId } = await withActiveLink();
    session = { user: { id: clientId } };
    const conv = await createConversation(clientId, "Share me");

    const res = await shareRequest("POST", conv.id);
    expect(res.status).toBe(204);
    expect(await getGrantStateForClient(clientId, conv.id)).toBe(true);
  });

  it("revokes a previously granted conversation", async () => {
    const { clientId } = await withActiveLink();
    session = { user: { id: clientId } };
    const conv = await createConversation(clientId, "Share then unshare");
    await shareRequest("POST", conv.id);

    const res = await shareRequest("DELETE", conv.id);
    expect(res.status).toBe(204);
    expect(await getGrantStateForClient(clientId, conv.id)).toBe(false);
  });

  it("returns 401 for POST when there is no session", async () => {
    session = null;
    const res = await shareRequest("POST", randomUUID());
    expect(res.status).toBe(401);
  });

  it("returns 401 for DELETE when there is no session", async () => {
    session = null;
    const res = await shareRequest("DELETE", randomUUID());
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed conversationId", async () => {
    const res = await shareRequest("POST", "not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns 400 with the module's message when the caller has no active therapist link", async () => {
    const soloClientId = `test-${randomUUID()}`;
    session = { user: { id: soloClientId } };
    const conv = await createConversation(soloClientId, "No link yet");
    const res = await shareRequest("POST", conv.id);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No active therapist link/);
  });

  it("returns 404 (never a hint) sharing a conversation owned by someone else", async () => {
    const { clientId } = await withActiveLink();
    session = { user: { id: clientId } };
    const foreign = await createConversation(`test-${randomUUID()}`, "Not yours");

    const res = await shareRequest("POST", foreign.id);
    expect(res.status).toBe(404);
  });

  it("returns 404 revoking a share on a conversation owned by someone else", async () => {
    const foreign = await createConversation(`test-${randomUUID()}`, "Not yours either");
    const res = await shareRequest("DELETE", foreign.id);
    expect(res.status).toBe(404);
  });
});
