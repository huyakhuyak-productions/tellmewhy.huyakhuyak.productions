import { describe, expect, it } from "vitest";
import {
  GENTLE_PACE,
  GENTLE_PACE_WORDS_SAFE_HERE,
  GENTLE_PACE_WORDS_STILL_HERE,
} from "./pacing-copy";

describe("pacing copy", () => {
  it("keeps the base gentle-pace sentence intact", () => {
    expect(GENTLE_PACE).toBe("A gentle pace — give it a moment, then try again.");
  });

  it("builds both reassurance tails on the same base so they can't drift", () => {
    expect(GENTLE_PACE_WORDS_STILL_HERE).toBe(`${GENTLE_PACE} Your words are still here.`);
    expect(GENTLE_PACE_WORDS_SAFE_HERE).toBe(`${GENTLE_PACE} Your words are safe here.`);
    expect(GENTLE_PACE_WORDS_STILL_HERE.startsWith(GENTLE_PACE)).toBe(true);
    expect(GENTLE_PACE_WORDS_SAFE_HERE.startsWith(GENTLE_PACE)).toBe(true);
  });
});
