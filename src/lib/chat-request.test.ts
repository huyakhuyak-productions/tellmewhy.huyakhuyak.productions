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

  it("falls back to a plain send when a regenerate carries no messageId", () => {
    const body = buildChatRequestBody({
      conversationId: CONVERSATION_ID,
      trigger: "regenerate-message",
      messageId: undefined,
      text: "",
      parentIdOf: () => undefined,
    });
    expect(body).toEqual({ conversationId: CONVERSATION_ID, text: "" });
  });
});
