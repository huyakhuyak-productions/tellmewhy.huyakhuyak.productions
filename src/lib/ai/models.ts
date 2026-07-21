import { createOpenRouter, type OpenRouterChatSettings } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { MOCK_FINISH_REASON, MOCK_USAGE, MockLanguageModelV3, simulateReadableStream } from "@/test/ai-fixtures";

// A misconfigured production deploy must never serve canned empathy instead
// of a real model — fail loudly at import time rather than silently mocking.
if (process.env.AI_MOCK === "1" && process.env.NODE_ENV === "production") {
  throw new Error("AI_MOCK must not be enabled in production");
}

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

const MOCK_REPLY_TEXT = "This is a **mock reply** for tests.";

// MOCK_SLOW is the streaming twin of MOCK_CRISIS: any message whose text
// contains this marker makes the mock stream its reply word-by-word with a
// per-chunk delay, instead of the usual single instant delta. That deliberate
// slowness gives an e2e test a reliable window to catch the stream mid-flight
// and hit "Stop generating" before it completes — and the honest partial the
// server persists on abort is whatever prefix arrived first. The reply's first
// word ("Slowly") and its unique tail word ("STREAMTAIL") let a test prove the
// persisted text is a genuine partial (has the head, lacks the tail).
const MOCK_SLOW_MARKER = "MOCK_SLOW";
const MOCK_SLOW_WORDS =
  "Slowly this partial reply keeps arriving one word at a time until the very last STREAMTAIL".split(
    " ",
  );

// Split the reply into per-word text deltas wrapped by the stream's start/end
// and finish parts. Leading space on every word after the first reconstitutes
// the sentence exactly when concatenated.
function slowStreamChunks() {
  return [
    { type: "text-start" as const, id: "1" },
    ...MOCK_SLOW_WORDS.map((word, i) => ({
      type: "text-delta" as const,
      id: "1",
      delta: i === 0 ? word : ` ${word}`,
    })),
    { type: "text-end" as const, id: "1" },
    { type: "finish" as const, finishReason: MOCK_FINISH_REASON, usage: MOCK_USAGE },
  ];
}

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
    doStream: async ({ prompt }) => {
      const slow = JSON.stringify(prompt).includes(MOCK_SLOW_MARKER);
      return {
        stream: simulateReadableStream({
          // A slow reply staggers each word so a test can interrupt it; the
          // default (0/0) keeps every other reply instant so nothing else slows.
          initialDelayInMs: slow ? 150 : 0,
          chunkDelayInMs: slow ? 180 : 0,
          chunks: slow
            ? slowStreamChunks()
            : [
                { type: "text-start", id: "1" },
                { type: "text-delta", id: "1", delta: MOCK_REPLY_TEXT },
                { type: "text-end", id: "1" },
                { type: "finish", finishReason: MOCK_FINISH_REASON, usage: MOCK_USAGE },
              ],
        }),
      };
    },
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

// Deterministic digest object for offline tests. `generateObject` drives the
// model through `doGenerate` and parses the single text part as JSON, so the
// mock returns the whole digest body as one stringified content part.
//
// Anchors: the digest transcript reaches the model as "[message <uuid>] …"
// lines (see digests.ts), and the domain drops any anchor whose messageId
// doesn't belong to the conversation — a static fake id would never survive to
// the therapist. Echoing the FIRST marker id from the prompt keeps the mock
// deterministic AND produces an anchor the hallucination filter accepts, so
// e2e can exercise the anchor-jump landing offline. A prompt with no marker
// (unit tests calling the model directly) gets no anchors, as before.
const MESSAGE_MARKER = /\[message ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/i;

function mockDigestModel(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const marker = JSON.stringify(prompt).match(MESSAGE_MARKER);
      const anchors = marker
        ? [{ messageId: marker[1], label: "A mock anchor", kind: "moment" }]
        : [];
      return {
        finishReason: MOCK_FINISH_REASON,
        usage: MOCK_USAGE,
        content: [
          {
            type: "text",
            text: JSON.stringify({ overview: "A mock digest overview.", themes: ["mock theme"], anchors }),
          },
        ],
        warnings: [],
      };
    },
  });
}

export function getDigestModel(): LanguageModel {
  if (process.env.AI_MOCK === "1") return mockDigestModel();
  return openrouter()(process.env.OPENROUTER_DIGEST_MODEL ?? "anthropic/claude-sonnet-4.5", NO_LOGGING);
}

// Deterministic thought-record for offline tests. Like the digest mock,
// `generateObject` drives this through `doGenerate` and parses the single text
// part as JSON, so the mock returns the whole payload as one stringified part.
const MOCK_THOUGHT_RECORD_JSON = JSON.stringify({
  situation: "Mock situation",
  thoughts: "Mock thoughts",
  emotions: "Mock emotions",
  behavior: "Mock behavior",
});

function mockExtractorModel(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: MOCK_FINISH_REASON,
      usage: MOCK_USAGE,
      content: [{ type: "text", text: MOCK_THOUGHT_RECORD_JSON }],
      warnings: [],
    }),
  });
}

// Structured extraction of a draft thought record from a conversation — the
// classifier default is plenty for pulling four short fields out of a
// transcript, and keeps this off the pricier chat/digest models.
export function getExtractorModel(): LanguageModel {
  if (process.env.AI_MOCK === "1") return mockExtractorModel();
  return openrouter()(process.env.OPENROUTER_CLASSIFIER_MODEL ?? "google/gemini-2.5-flash-lite", NO_LOGGING);
}
