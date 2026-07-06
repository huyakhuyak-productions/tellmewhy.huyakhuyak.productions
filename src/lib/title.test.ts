import { describe, expect, it } from "vitest";
import { clampTitle } from "./title";

// A lone (unpaired) UTF-16 surrogate anywhere in the string — the mojibake
// artifact a naive `.slice(0, 80)` produces when it lands mid surrogate-pair.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("clampTitle", () => {
  it("leaves short titles untouched", () => {
    expect(clampTitle("A quiet Tuesday")).toBe("A quiet Tuesday");
  });

  it("clamps to 80 code points", () => {
    expect(clampTitle("a".repeat(200))).toBe("a".repeat(80));
  });

  it("keeps an emoji whole when its surrogate pair straddles the naive slice(0, 80) boundary", () => {
    // 79 ASCII code points + one emoji (a surrogate pair, 2 UTF-16 units) =
    // 81 UTF-16 units total, but only 80 code points — the emoji's two
    // halves sit at UTF-16 units 80 and 81, exactly where `.slice(0, 80)`
    // (a code-unit slice) would cut, dropping only its low surrogate.
    const emoji = "\u{1F600}"; // 😀, U+1F600
    const title = "a".repeat(79) + emoji;
    expect(title.length).toBe(81); // confirms the UTF-16 setup above

    const clamped = clampTitle(title);
    expect(clamped).toBe(title); // exactly 80 code points — nothing to drop
    expect(LONE_SURROGATE.test(clamped)).toBe(false);
  });

  it("drops a trailing emoji whole, rather than splitting it, once over budget", () => {
    const emoji = "\u{1F600}";
    const title = "a".repeat(80) + emoji; // already 80 code points before the emoji
    const clamped = clampTitle(title);
    expect(clamped).toBe("a".repeat(80));
    expect(LONE_SURROGATE.test(clamped)).toBe(false);
  });
});
