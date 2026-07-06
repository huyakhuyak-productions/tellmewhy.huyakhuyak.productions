import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createConversation, isTitleCustomized, listConversations, loadMessages, renameConversation, saveMessage } from "@/lib/conversations";

// Auth is mocked at the module boundary; everything below it is real
// (repo, crypto, mock models via AI_MOCK=1).
const userId = `test-${randomUUID()}`;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: userId } })) } },
}));
// next/headers needs Next.js request scope — stub it for direct route invocation.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Spy-mode keeps the real implementation by default, so the happy-path tests
// below are unaffected — only the failure test overrides a single call.
vi.mock("@/lib/conversations", { spy: true });

import { POST } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("returns 400 (not a 500) for a malformed JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a conversation the user does not own", async () => {
    const foreign = await createConversation("someone-else", "Not yours");
    const res = await POST(chatRequest({ conversationId: foreign.id, text: "hi" }));
    expect(res.status).toBe(404);
  });

  it("logs and does not crash when persisting the AI reply fails", async () => {
    const { id } = await createConversation(userId, "Persistence hiccup");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockedSaveMessage = vi.mocked(saveMessage);
    const realSaveMessage = mockedSaveMessage.getMockImplementation()!;
    // First call (the client message) goes through to the real implementation;
    // the second call (the AI reply, made from onFinish) rejects.
    mockedSaveMessage.mockImplementationOnce(realSaveMessage);
    mockedSaveMessage.mockImplementationOnce(async () => {
      throw new Error("simulated persistence failure");
    });

    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish (and its failed save) runs

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
    const [logMessage, loggedError] = consoleErrorSpy.mock.calls[0]!;
    expect(logMessage).toContain(id);
    expect(loggedError).toBeInstanceOf(Error);

    const msgs = await loadMessages(id, userId);
    expect(msgs.map((m) => m.sender)).toEqual(["client"]);
  });

  it("auto-titles the conversation after the first exchange", async () => {
    const { id } = await createConversation(userId, "Untitled");
    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish (and the title call) runs

    await vi.waitFor(async () => {
      const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
      expect(conversation?.title).toBe("A quiet mock title");
    });
    expect(await isTitleCustomized(id, userId)).toBe(false);
  });

  it("does not retitle on the second exchange in the same conversation", async () => {
    const { id } = await createConversation(userId, "Untitled");
    const first = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    await first.text();
    await vi.waitFor(async () => {
      const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
      expect(conversation?.title).toBe("A quiet mock title");
    });

    await renameConversation(id, userId, "A quiet mock title", { customized: false });
    const second = await POST(chatRequest({ conversationId: id, text: "Still thinking about it" }));
    await second.text();

    // Give any (unwanted) second auto-title call a chance to run before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
    expect(conversation?.title).toBe("A quiet mock title");
    expect(await isTitleCustomized(id, userId)).toBe(false);
  });

  it("never overwrites a title the user already customized", async () => {
    const { id } = await createConversation(userId, "Untitled");
    await renameConversation(id, userId, "Mine");
    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    await res.text();

    // Give the (unwanted) auto-title call a chance to run before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
    expect(conversation?.title).toBe("Mine");
    expect(await isTitleCustomized(id, userId)).toBe(true);
  });
});
