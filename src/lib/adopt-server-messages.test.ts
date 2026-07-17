import { describe, expect, it } from "vitest";
import { isAtRest, shouldAdoptServerMessages } from "./adopt-server-messages";

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

describe("isAtRest", () => {
  it('is true for "ready" — a clean settle', () => {
    expect(isAtRest("ready")).toBe(true);
  });

  it('is true for "error" — a sticky resting state (nothing clears it), so a version switch after a failed send must still adopt', () => {
    expect(isAtRest("error")).toBe(true);
  });

  it('is false for "submitted" — the SDK owns the thread while a send is in flight', () => {
    expect(isAtRest("submitted")).toBe(false);
  });

  it('is false for "streaming" — adopting would overwrite the incoming reply', () => {
    expect(isAtRest("streaming")).toBe(false);
  });
});
