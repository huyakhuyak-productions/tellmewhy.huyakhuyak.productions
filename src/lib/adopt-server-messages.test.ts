import { describe, expect, it } from "vitest";
import { shouldAdoptServerMessages } from "./adopt-server-messages";

describe("shouldAdoptServerMessages", () => {
  it("is false for two empty lists", () => {
    expect(shouldAdoptServerMessages([], [])).toBe(false);
  });

  it("is false for identical ordered lists", () => {
    expect(shouldAdoptServerMessages(["a", "b", "c"], ["a", "b", "c"])).toBe(false);
  });

  it("is true when the server carries an extra row", () => {
    expect(shouldAdoptServerMessages(["a", "b"], ["a", "b", "c"])).toBe(true);
  });

  it("is true when the local list is longer than the server's", () => {
    expect(shouldAdoptServerMessages(["a", "b", "c"], ["a", "b"])).toBe(true);
  });

  it("is true when an id differs at a single position (a branch swap)", () => {
    expect(shouldAdoptServerMessages(["a", "b", "c"], ["a", "x", "c"])).toBe(true);
  });

  it("is true when the same ids arrive in a different order", () => {
    expect(shouldAdoptServerMessages(["a", "b"], ["b", "a"])).toBe(true);
  });
});
