import { describe, expect, it } from "vitest";
import { countMessagesAfter, coverageLine } from "./digest-coverage";

describe("countMessagesAfter", () => {
  it("returns 0 when the covered message is the last one", () => {
    expect(countMessagesAfter(["a", "b", "c"], "c")).toBe(0);
  });

  it("counts every message after the covered one", () => {
    expect(countMessagesAfter(["a", "b", "c", "d"], "b")).toBe(2);
  });

  it("returns 1 for a single trailing message", () => {
    expect(countMessagesAfter(["a", "b"], "a")).toBe(1);
  });

  it("returns null when the covered message is no longer present", () => {
    expect(countMessagesAfter(["a", "b", "c"], "gone")).toBeNull();
  });

  it("returns null for an empty conversation", () => {
    expect(countMessagesAfter([], "a")).toBeNull();
  });
});

describe("coverageLine", () => {
  it("states full coverage when not stale", () => {
    expect(coverageLine(false, 0)).toBe(
      "Covers the whole conversation, through the latest message.",
    );
  });

  it("treats a stale digest with zero newer messages as fully current", () => {
    // Self-healed between generation and read: nothing left to fold in.
    expect(coverageLine(true, 0)).toBe(
      "Covers the whole conversation, through the latest message.",
    );
  });

  it("singularizes a single newer message", () => {
    expect(coverageLine(true, 1)).toBe(
      "Covers up to an earlier message — 1 newer message hasn't been folded in yet.",
    );
  });

  it("pluralizes multiple newer messages", () => {
    expect(coverageLine(true, 4)).toBe(
      "Covers up to an earlier message — 4 newer messages haven't been folded in yet.",
    );
  });

  it("falls back to a generic line when the count is unknown", () => {
    expect(coverageLine(true, null)).toBe(
      "Covers up to an earlier point — newer messages haven't been folded in yet.",
    );
  });
});
