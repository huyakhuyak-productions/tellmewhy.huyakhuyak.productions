import { describe, expect, it } from "vitest";
import {
  SERVICE_ISSUE,
  SERVICE_ISSUE_CODE,
  SERVICE_ISSUE_TRY_LATER,
  SERVICE_ISSUE_WORDS_SAFE_BELOW,
} from "./service-issue-copy";

describe("service-issue copy", () => {
  it("keeps the base sentence intact — an internal issue, the owner told, nothing more", () => {
    expect(SERVICE_ISSUE).toBe("Something's not right on our end — the owner has been told.");
  });

  it("never breaks immersion: no mention of credits, AI, models, or a provider", () => {
    for (const copy of [SERVICE_ISSUE, SERVICE_ISSUE_WORDS_SAFE_BELOW, SERVICE_ISSUE_TRY_LATER]) {
      expect(copy).not.toMatch(/credit|\bAI\b|model|openrouter|provider|quota|billing/i);
    }
  });

  it("builds both tails on the same base so they can't drift", () => {
    expect(SERVICE_ISSUE_WORDS_SAFE_BELOW).toBe(`${SERVICE_ISSUE} Your words are safe below.`);
    expect(SERVICE_ISSUE_TRY_LATER).toBe(`${SERVICE_ISSUE} Try again a little later.`);
  });

  it("carries a short wire code that is not itself user-facing prose", () => {
    expect(SERVICE_ISSUE_CODE).toBe("service-issue");
    expect(SERVICE_ISSUE).not.toContain(SERVICE_ISSUE_CODE);
  });
});
