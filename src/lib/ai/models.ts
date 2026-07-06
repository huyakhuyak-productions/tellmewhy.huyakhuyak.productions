import { createOpenRouter, type OpenRouterChatSettings } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

// Privacy: refuse providers that log or train on prompts. This ships with
// EVERY OpenRouter request — it is part of the product's trust contract.
//
// Adaptation: @openrouter/ai-sdk-provider@2.10.0 exposes `provider.data_collection`
// as a typed field on `OpenRouterChatSettings` (per-model call settings), not as a
// provider-level `extraBody` option. Passing it as the second argument to the
// `openrouter(modelId, settings)` call applies it to every request for that model.
const NO_LOGGING: OpenRouterChatSettings = { provider: { data_collection: "deny" } };

function openrouter() {
  return createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
}

// Adaptation: installed `ai@6.0.214` renames `ai/test`'s mock class to
// `MockLanguageModelV3` (not `MockLanguageModelV2`), and its
// `LanguageModelV3GenerateResult` / stream `finish` part require nested
// `finishReason: { unified, raw }` and nested `usage: { inputTokens: {...},
// outputTokens: {...} }` shapes instead of the brief's flat v5-era shapes.
// Shape confirmed against src/lib/ai/crisis.test.ts's working mockClassifier.
const MOCK_FINISH_REASON = { unified: "stop", raw: "stop" } as const;
const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
} as const;

const MOCK_REPLY_TEXT = "This is a **mock reply** for tests.";

function mockChatModel(): LanguageModel {
  return new MockLanguageModelV3({
    // `generateText` calls `doGenerate`; `streamText` calls `doStream`. Both are
    // implemented so the mock works for either call style callers may use.
    doGenerate: async () => ({
      finishReason: MOCK_FINISH_REASON,
      usage: MOCK_USAGE,
      content: [{ type: "text", text: MOCK_REPLY_TEXT }],
      warnings: [],
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: MOCK_REPLY_TEXT },
          { type: "text-end", id: "1" },
          { type: "finish", finishReason: MOCK_FINISH_REASON, usage: MOCK_USAGE },
        ],
      }),
    }),
  });
}

function mockClassifierModel(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => ({
      finishReason: MOCK_FINISH_REASON,
      usage: MOCK_USAGE,
      content: [
        { type: "text", text: JSON.stringify({ risk: JSON.stringify(prompt).includes("MOCK_CRISIS") ? "crisis" : "none" }) },
      ],
      warnings: [],
    }),
  });
}

export function getChatModel(): LanguageModel {
  if (process.env.AI_MOCK === "1") return mockChatModel();
  return openrouter()(process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5", NO_LOGGING);
}

export function getClassifierModel(): LanguageModel {
  if (process.env.AI_MOCK === "1") return mockClassifierModel();
  return openrouter()(process.env.OPENROUTER_CLASSIFIER_MODEL ?? "google/gemini-2.5-flash-lite", NO_LOGGING);
}

const MOCK_TITLE_TEXT = "A quiet mock title";

function mockTitleModel(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: MOCK_FINISH_REASON,
      usage: MOCK_USAGE,
      content: [{ type: "text", text: MOCK_TITLE_TEXT }],
      warnings: [],
    }),
  });
}

export function getTitleModel(): LanguageModel {
  if (process.env.AI_MOCK === "1") return mockTitleModel();
  return openrouter()(process.env.OPENROUTER_CLASSIFIER_MODEL ?? "google/gemini-2.5-flash-lite", NO_LOGGING);
}
