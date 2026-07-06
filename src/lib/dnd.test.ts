import { describe, it, expect } from "vitest";
import {
  CONVERSATION_DND_MIME,
  setConversationDragData,
  hasConversationDragData,
  getConversationDragId,
} from "./dnd";

/**
 * Minimal stub DataTransfer for testing. Implements only the members
 * our helpers touch: setData, getData, types.
 */
function createStubDataTransfer(): DataTransfer {
  const data = new Map<string, string>();

  return {
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    getData: (type: string) => {
      return data.get(type) || "";
    },
    get types() {
      return Array.from(data.keys());
    },
    // Stubs for required DataTransfer properties (unused by our helpers)
    dropEffect: "none",
    effectAllowed: "uninitialized",
    items: ([] as unknown) as DataTransferItemList,
    files: ([] as unknown) as FileList,
    clearData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

describe("Conversation DnD helpers", () => {
  it("set→has→get round-trip with conversation mime type", () => {
    const dt = createStubDataTransfer();
    const conversationId = "conv-123";

    setConversationDragData(dt, conversationId);

    expect(hasConversationDragData(dt)).toBe(true);
    expect(getConversationDragId(dt)).toBe(conversationId);
  });

  it("wrong mime type → has returns false", () => {
    const dt = createStubDataTransfer();
    dt.setData("text/plain", "some-id");

    expect(hasConversationDragData(dt)).toBe(false);
  });

  it("wrong mime type → get falls back to text/plain", () => {
    const dt = createStubDataTransfer();
    const fallbackId = "fallback-456";
    dt.setData("text/plain", fallbackId);

    expect(getConversationDragId(dt)).toBe(fallbackId);
  });

  it("empty/absent data → has returns false", () => {
    const dt = createStubDataTransfer();

    expect(hasConversationDragData(dt)).toBe(false);
  });

  it("empty/absent data → get returns empty string", () => {
    const dt = createStubDataTransfer();

    expect(getConversationDragId(dt)).toBe("");
  });

  it("setConversationDragData sets both mime type and text/plain", () => {
    const dt = createStubDataTransfer();
    const conversationId = "conv-789";

    setConversationDragData(dt, conversationId);

    expect(dt.getData(CONVERSATION_DND_MIME)).toBe(conversationId);
    expect(dt.getData("text/plain")).toBe(conversationId);
    expect(dt.effectAllowed).toBe("move");
  });
});
