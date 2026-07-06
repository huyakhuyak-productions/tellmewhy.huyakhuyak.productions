import { describe, expect, it } from "vitest";
import { wrapFocus } from "./focus-trap";

describe("wrapFocus", () => {
  const items = ["a", "b", "c"];

  it("wraps Tab off the last element back to the first", () => {
    expect(wrapFocus(items, "c", false)).toBe("a");
  });

  it("wraps Shift+Tab off the first element to the last", () => {
    expect(wrapFocus(items, "a", true)).toBe("c");
  });

  it("lets native Tab through when focus is mid-list", () => {
    expect(wrapFocus(items, "b", false)).toBeNull();
    expect(wrapFocus(items, "b", true)).toBeNull();
  });

  it("does not wrap Tab off the first, or Shift+Tab off the last", () => {
    expect(wrapFocus(items, "a", false)).toBeNull();
    expect(wrapFocus(items, "c", true)).toBeNull();
  });

  it("pulls focus back inside when it has escaped the trap", () => {
    // Active element is not among the focusables (focus leaked out): Tab lands
    // on the first, Shift+Tab on the last.
    expect(wrapFocus(items, "x", false)).toBe("a");
    expect(wrapFocus(items, "x", true)).toBe("c");
    expect(wrapFocus(items, null, false)).toBe("a");
    expect(wrapFocus(items, null, true)).toBe("c");
  });

  it("returns null when there is nothing to focus", () => {
    expect(wrapFocus([], "a", false)).toBeNull();
  });

  it("treats a single focusable as both first and last", () => {
    expect(wrapFocus(["only"], "only", false)).toBe("only");
    expect(wrapFocus(["only"], "only", true)).toBe("only");
  });
});
