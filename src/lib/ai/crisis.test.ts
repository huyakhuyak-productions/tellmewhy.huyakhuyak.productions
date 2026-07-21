import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { assessRisk, RISK_MAX_OUTPUT_TOKENS, screenText } from "./crisis";
import { MOCK_FINISH_REASON, MOCK_USAGE, mockClassifier } from "@/test/ai-fixtures";

describe("screenText", () => {
  it.each([
    "I want to kill myself",
    "i've been thinking about ending my life",
    "I don't want to be alive anymore",
    "thinking about suicide again",
    "I want to hurt myself tonight",
  ])("flags explicit crisis phrasing: %s", (text) => {
    expect(screenText(text)).toBe("crisis");
  });

  it.each(["I had a hard day at work", "my plant died and I'm sad", "I killed it at the gym"])(
    "does not flag ordinary distress: %s",
    (text) => {
      expect(screenText(text)).toBe("none");
    },
  );
});

describe("assessRisk", () => {
  it("returns the model's verdict when the regex finds nothing", async () => {
    const level = await assessRisk("everything feels pointless lately", mockClassifier('{"risk":"elevated"}'));
    expect(level).toBe("elevated");
  });

  it("never downgrades below the regex floor", async () => {
    const level = await assessRisk("I want to kill myself", mockClassifier('{"risk":"none"}'));
    expect(level).toBe("crisis");
  });

  it("falls back to the regex result when the model fails", async () => {
    const broken = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("provider down");
      },
    });
    // Each failing call now logs (by design, tested below) — keep it off stderr.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await assessRisk("I want to kill myself", broken)).toBe("crisis");
      expect(await assessRisk("rough week", broken)).toBe("none");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs when the model fails, so a dead classifier is never silent", async () => {
    const broken = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("provider down");
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await assessRisk("rough week", broken);
      expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("Failed to classify risk"))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("never logs the message plaintext carried on a classifier error", async () => {
    const sentinel = "SENTINEL_PLAINTEXT";
    const broken = new MockLanguageModelV3({
      doGenerate: async () => {
        // AI SDK errors carry the request body (the classified message itself)
        // as enumerable own properties; the sentinel stands in for it.
        const error = new Error("Bad Request");
        Object.assign(error, { requestBodyValues: { prompt: sentinel }, responseBody: sentinel });
        throw error;
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await assessRisk(sentinel, broken);
      const logged = errorSpy.mock.calls
        .map((args) => args.map((a) => inspect(a, { depth: 20 })).join(" "))
        .join("\n");
      expect(logged).toContain("Failed to classify risk");
      expect(logged).not.toContain(sentinel);
    } finally {
      errorSpy.mockRestore();
    }
  });

  // Pins the budget EXACTLY, in both directions. Uncapped (the production
  // bug), the provider reserves the model's whole 65535-token window and
  // OpenRouter rejects the call outright, silently disabling this entire
  // raise-only layer. Capped too tightly, a reasoning model burns the budget
  // on thinking tokens and the truncated JSON fails to parse — which lands in
  // the same place. A one-sided assertion would let either regression through.
  it("reserves exactly the classifier's output budget — neither uncapped nor starved", async () => {
    let seen: number | undefined;
    const capture = new MockLanguageModelV3({
      doGenerate: async (options) => {
        seen = options.maxOutputTokens;
        return {
          finishReason: MOCK_FINISH_REASON,
          usage: MOCK_USAGE,
          content: [{ type: "text", text: '{"risk":"none"}' }],
          warnings: [],
        };
      },
    });
    await assessRisk("rough week", capture);
    expect(seen).toBe(RISK_MAX_OUTPUT_TOKENS);
    expect(RISK_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(64);
  });
});
