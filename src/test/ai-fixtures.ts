import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

// Adaptation: installed `ai@6.0.214` renames `ai/test`'s mock class to
// `MockLanguageModelV3` (not `MockLanguageModelV2`), and its
// `LanguageModelV3GenerateResult` / stream `finish` part require nested
// `finishReason: { unified, raw }` and nested `usage: { inputTokens: {...},
// outputTokens: {...} }` shapes instead of the v5-era flat shapes. Shared here
// so src/lib/ai/models.ts, crisis.test.ts, and models.test.ts don't each
// redeclare the same v6 mock scaffolding.
export const MOCK_FINISH_REASON = { unified: "stop", raw: "stop" } as const;
export const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
} as const;

export const riskSchema = z.object({ risk: z.enum(["none", "elevated", "crisis"]) });

// A classifier mock that always answers with a fixed reply, regardless of prompt.
export function mockClassifier(reply: string): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: MOCK_FINISH_REASON,
      usage: MOCK_USAGE,
      content: [{ type: "text", text: reply }],
      warnings: [],
    }),
  });
}
