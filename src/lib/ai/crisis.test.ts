import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { assessRisk, screenText } from "./crisis";

// Brief was drafted against ai@5-era `MockLanguageModelV2` / flat `doGenerate`
// result shape. Installed version is ai@6.0.214, whose `ai/test` export is
// `MockLanguageModelV3`, and whose `LanguageModelV3GenerateResult` requires:
//   - `finishReason` as `{ unified, raw }` instead of a bare string
//   - `usage` as nested `{ inputTokens: {...}, outputTokens: {...} }` instead
//     of flat `{ inputTokens, outputTokens, totalTokens }`
// Test *behavior* (fixed JSON verdict text / a thrown error) is unchanged.
function mockClassifier(reply: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      content: [{ type: "text", text: reply }],
      warnings: [],
    }),
  });
}

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
    expect(await assessRisk("I want to kill myself", broken)).toBe("crisis");
    expect(await assessRisk("rough week", broken)).toBe("none");
  });
});
