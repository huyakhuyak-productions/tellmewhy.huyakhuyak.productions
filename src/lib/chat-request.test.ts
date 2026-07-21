import { describe, expect, it } from "vitest";
import { buildChatRequestBody } from "./chat-request";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";

describe("buildChatRequestBody", () => {
  it("builds a plain send when there is no messageId", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "submit-message",
      messageId: undefined,
      text: "hello",
      parentIdOf: () => {
        throw new Error("parentIdOf must not be consulted for a plain send");
      },
    });
    expect(body).toEqual({ conversationId: CONVERSATION_ID, text: "hello" });
  });

  it("builds an edit that reuses the edited message's parent", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "submit-message",
      messageId: "msg-2",
      text: "reworded",
      parentIdOf: (id) => (id === "msg-2" ? "msg-1" : undefined),
    });
    expect(body).toEqual({
      conversationId: CONVERSATION_ID,
      text: "reworded",
      parentId: "msg-1",
    });
  });

  it("builds an edit at the root with an explicit null parentId", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "submit-message",
      messageId: "root",
      text: "first line, reworded",
      parentIdOf: () => null,
    });
    expect(body).toEqual({
      conversationId: CONVERSATION_ID,
      text: "first line, reworded",
      parentId: null,
    });
  });

  it("omits parentId when the edited message's meta is unknown", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "submit-message",
      messageId: "unknown",
      text: "reworded",
      parentIdOf: () => undefined,
    });
    expect(body).toEqual({ conversationId: CONVERSATION_ID, text: "reworded" });
  });

  it("carries the clientMessageId on a plain send", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "submit-message",
      messageId: undefined,
      text: "hello",
      parentIdOf: () => undefined,
      clientMessageId: "22222222-2222-4222-8222-222222222222",
    });
    expect(body).toEqual({
      conversationId: CONVERSATION_ID,
      text: "hello",
      clientMessageId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("carries the clientMessageId on an edit alongside the branch parent", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "submit-message",
      messageId: "msg-2",
      text: "reworded",
      parentIdOf: (id) => (id === "msg-2" ? "msg-1" : undefined),
      clientMessageId: "33333333-3333-4333-8333-333333333333",
    });
    expect(body).toEqual({
      conversationId: CONVERSATION_ID,
      text: "reworded",
      parentId: "msg-1",
      clientMessageId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("never carries a clientMessageId on a regenerate (no new client turn to persist)", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "regenerate-message",
      messageId: "ai-3",
      text: "",
      parentIdOf: () => undefined,
      clientMessageId: "44444444-4444-4444-8444-444444444444",
    });
    expect(body).toEqual({ conversationId: CONVERSATION_ID, regenerateOf: "ai-3" });
  });

  it("builds a regenerate referencing the message being regenerated", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "regenerate-message",
      messageId: "ai-3",
      text: "",
      parentIdOf: () => {
        throw new Error("parentIdOf must not be consulted for a regenerate");
      },
    });
    expect(body).toEqual({ conversationId: CONVERSATION_ID, regenerateOf: "ai-3" });
  });

  it("throws on a regenerate with no messageId instead of round-tripping to a silent 400", () => {
    // A regenerate names the reply it re-runs; without an id there is no
    // target. The old fallback emitted { text: "" }, which the server's
    // min(1) text guard rejected as an opaque 400. A throw fails loudly at
    // the mapper — the degenerate shape is programmer error, never a request.
    expect(() =>
      buildChatRequestBody({
        conversationId: CONVERSATION_ID,
        trigger: "regenerate-message",
        messageId: undefined,
        text: "",
        parentIdOf: () => undefined,
      }),
    ).toThrow();
  });
});
