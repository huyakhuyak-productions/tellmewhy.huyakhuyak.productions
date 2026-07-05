import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createConversation, loadMessages } from "@/lib/conversations";

// Auth is mocked at the module boundary; everything below it is real
// (repo, crypto, mock models via AI_MOCK=1).
const userId = `test-${randomUUID()}`;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: userId } })) } },
}));
// next/headers needs Next.js request scope — stub it for direct route invocation.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST } from "./route";

function chatRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  it("streams a reply and persists both messages encrypted", async () => {
    const { id } = await createConversation(userId, "Test chat");
    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish persistence runs
    await vi.waitFor(async () => {
      const msgs = await loadMessages(id, userId);
      expect(msgs.map((m) => m.sender)).toEqual(["client", "ai"]);
      expect(msgs[1].text).toContain("mock reply");
    });
  });

  it("marks crisis messages and reports the level in a header", async () => {
    const { id } = await createConversation(userId, "Hard night");
    const res = await POST(chatRequest({ conversationId: id, text: "I want to kill myself" }));
    expect(res.headers.get("x-risk-level")).toBe("crisis");
    await res.text();
    const [clientMsg] = await loadMessages(id, userId);
    expect(clientMsg.riskLevel).toBe("crisis");
  });

  it("rejects a conversation the user does not own", async () => {
    const foreign = await createConversation("someone-else", "Not yours");
    const res = await POST(chatRequest({ conversationId: foreign.id, text: "hi" }));
    expect(res.status).toBe(404);
  });
});
