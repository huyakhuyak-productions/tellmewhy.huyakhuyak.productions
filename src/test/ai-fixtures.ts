import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

// Adaptation: installed `ai@6.0.214` renames `ai/test`'s mock class to
// `MockLanguageModelV3` (not `MockLanguageModelV2`), and its
// `LanguageModelV3GenerateResult` / stream `finish` part require nested
// `finishReason: { unified, raw }` and nested `usage: { inputTokens: {...},
// outputTokens: {...} }` shapes instead of the v5-era flat shapes. This module
// is the single home for that v6 mock scaffolding — every caller (models.ts,
// crisis.test.ts, digests.test.ts, chat/route.test.ts, extract/route.test.ts)
// imports the class, the finish/usage constants, and the shared model factories
// from here instead of re-reaching into `ai/test` (or re-declaring the shapes).
export { MockLanguageModelV3 } from "ai/test";
export { simulateReadableStream } from "ai";

export const MOCK_FINISH_REASON = { unified: "stop", raw: "stop" } as const;
export const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
} as const;

export const riskSchema = z.object({ risk: z.enum(["none", "elevated", "crisis"]) });

// A model whose `doGenerate` answers with a fixed text reply, regardless of the
// prompt — the workhorse behind the classifier and object-generation mocks.
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

// A model whose `doGenerate` returns a fixed object serialized as its single
// text part — the shape structured-output callers (digest, extractor) parse.
export function mockObjectModel(body: unknown): LanguageModel {
  return mockClassifier(JSON.stringify(body));
}

// A model whose `doGenerate` returns well-formed content but reports a non-`stop`
// finish (the model ran out of its token budget mid-object, or a content filter
// cut it off). v6's `generateText` + `Output.object` refuses to hand this back as
// a result — reading the returned `output` getter throws `NoOutputGeneratedError`
// — so every structured-output call site must treat it as a failed generation
// rather than let a partial masquerade as a full result.
export function truncatedObjectModel(body: unknown): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: "length", raw: "length" },
      usage: MOCK_USAGE,
      content: [{ type: "text", text: JSON.stringify(body) }],
      warnings: [],
    }),
  });
}

// A model whose `doGenerate` rejects — the provider-down / generation-failure
// path. Default message stands in for any plain transport error.
export function throwingModel(message = "provider down"): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error(message);
    },
  });
}

// A model whose `doGenerate` throws an AI-SDK-shaped error that carries the
// request body / generated text as enumerable own properties — exactly how a
// real OpenRouter failure (APICallError, NoObjectGeneratedError) leaks the
// decrypted prompt. `sentinel` stands in for that client plaintext, so the
// leak-prevention tests can assert it never reaches a log.
export function payloadCarryingFailureModel(sentinel: string, message = "Bad Request"): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const error = new Error(message);
      Object.assign(error, {
        requestBodyValues: { prompt: sentinel },
        text: sentinel,
        responseBody: sentinel,
      });
      throw error;
    },
  });
}
