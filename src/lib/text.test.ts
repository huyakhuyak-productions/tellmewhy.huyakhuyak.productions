import { describe, expect, it } from "vitest";
import { normalizeForPrompt, truncateToCodePoints } from "./text";

describe("truncateToCodePoints", () => {
  it("returns the text unchanged when it fits within the limit", () => {
    expect(truncateToCodePoints("hello", 5)).toBe("hello");
    expect(truncateToCodePoints("hi", 10)).toBe("hi");
    expect(truncateToCodePoints("", 3)).toBe("");
  });

  it("cuts to the requested number of code points", () => {
    expect(truncateToCodePoints("hello world", 5)).toBe("hello");
  });

  it("counts astral glyphs as one code point each and never splits a surrogate pair", () => {
    // Each emoji is two UTF-16 units but one code point — a naive .slice(0, 2)
    // would keep half of the second emoji as a broken � character.
    const emojis = "😀😀😀";
    expect(truncateToCodePoints(emojis, 2)).toBe("😀😀");
    // The cut lands on a whole code point, so the result is always valid text.
    expect([...truncateToCodePoints(emojis, 2)]).toHaveLength(2);
  });
});

describe("normalizeForPrompt", () => {
  it("folds CRLF and lone CR to LF", () => {
    expect(normalizeForPrompt("a\r\nb\rc", 100)).toBe("a\nb\nc");
  });

  it("caps a run of blank lines to a single one", () => {
    expect(normalizeForPrompt("a\n\n\n\n\nb", 100)).toBe("a\n\nb");
  });

  it("trims surrounding whitespace and bounds the length", () => {
    expect(normalizeForPrompt("  hello  ", 100)).toBe("hello");
    expect(normalizeForPrompt("abcdef", 3)).toBe("abc");
  });

  it("leaves already-clean single newlines intact", () => {
    expect(normalizeForPrompt("line one\nline two", 100)).toBe("line one\nline two");
  });
});
