import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { harvestFailedSend, mergeRestoredDraft, partsToText, resendMessageId } from "./send-recovery";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function user(text: string, id = "u-fail"): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(text: string, id = "a-ok"): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

describe("partsToText", () => {
  it("joins text parts and ignores non-text parts", () => {
    expect(
      partsToText([
        { type: "step-start" },
        { type: "text", text: "hello " },
        { type: "text", text: "there" },
      ]),
    ).toBe("hello there");
  });
});

describe("harvestFailedSend", () => {
  it("pulls a tail user message out and returns the thread without it", () => {
    const thread = [user("first", "u1"), assistant("reply", "a1"), user("lost words", "u2")];
    const failure = harvestFailedSend(thread);
    expect(failure).not.toBeNull();
    expect(failure?.failedText).toBe("lost words");
    expect(failure?.messagesWithoutFailure.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("also drops a partial assistant reply that arrived before the stream died", () => {
    const thread = [user("lost words", "u1"), assistant("half a th", "a-partial")];
    const failure = harvestFailedSend(thread);
    expect(failure?.failedText).toBe("lost words");
    expect(failure?.messagesWithoutFailure).toEqual([]);
  });

  it("returns null when there is no user message to recover", () => {
    expect(harvestFailedSend([])).toBeNull();
    expect(harvestFailedSend([assistant("only ai")])).toBeNull();
  });

  it("returns null when the last user message carries no text", () => {
    expect(harvestFailedSend([{ id: "u1", role: "user", parts: [] }])).toBeNull();
  });
});

describe("resendMessageId", () => {
  const failed = { id: "11111111-1111-4111-8111-111111111111", text: "lost words" };

  it("reuses the failed attempt's id when the composer still holds the same words", () => {
    expect(resendMessageId(failed, "lost words")).toBe(failed.id);
    // Surrounding whitespace is not a meaningful edit — the restore re-inserts
    // the words verbatim, so a trim-equal draft is an untouched retry.
    expect(resendMessageId(failed, "  lost words \n")).toBe(failed.id);
  });

  it("mints a fresh id when the draft was edited", () => {
    const id = resendMessageId(failed, "lost words, reworded");
    expect(id).not.toBe(failed.id);
    expect(id).toMatch(UUID);
  });

  it("mints a fresh id when there is no failed send stashed", () => {
    expect(resendMessageId(null, "a brand-new thought")).toMatch(UUID);
  });
});

describe("mergeRestoredDraft", () => {
  it("fills an empty composer with the failed words", () => {
    expect(mergeRestoredDraft("lost words", "")).toBe("lost words");
    expect(mergeRestoredDraft("lost words", "   \n")).toBe("lost words");
  });

  it("keeps words typed mid-flight, placing the failed (older) words first", () => {
    expect(mergeRestoredDraft("lost words", "a new thought")).toBe(
      "lost words\n\na new thought",
    );
  });

  it("never duplicates when the composer already holds the failed words", () => {
    expect(mergeRestoredDraft("lost words", "lost words")).toBe("lost words");
    expect(mergeRestoredDraft("lost words", " lost words ")).toBe(" lost words ");
  });
});
