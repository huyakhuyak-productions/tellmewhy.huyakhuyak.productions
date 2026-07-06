import { describe, expect, it } from "vitest";
import { isLongForm } from "./message-form";

describe("isLongForm", () => {
  it("keeps short single-paragraph text as a bubble", () => {
    expect(isLongForm("I had a hard day.")).toBe(false);
  });
  it("treats exactly 280 chars as a bubble and 281 as a passage", () => {
    expect(isLongForm("a".repeat(280))).toBe(false);
    expect(isLongForm("a".repeat(281))).toBe(true);
  });
  it("treats two paragraphs as a passage regardless of length", () => {
    expect(isLongForm("First thought.\n\nSecond thought.")).toBe(true);
  });
  it("ignores blank-only paragraphs", () => {
    expect(isLongForm("One thought.\n\n   \n\n")).toBe(false);
  });
});
