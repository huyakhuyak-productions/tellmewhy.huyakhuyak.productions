import { describe, expect, it } from "vitest";
import { entryCountLabel } from "./exercise-engagement";

describe("entryCountLabel", () => {
  it("reads as an empty invitation with no entries", () => {
    expect(entryCountLabel(0)).toBe("No entries yet");
  });

  it("never shows a negative count", () => {
    expect(entryCountLabel(-3)).toBe("No entries yet");
  });

  it("singularizes a single entry", () => {
    expect(entryCountLabel(1)).toBe("1 entry");
  });

  it("pluralizes multiple entries", () => {
    expect(entryCountLabel(5)).toBe("5 entries");
  });
});
