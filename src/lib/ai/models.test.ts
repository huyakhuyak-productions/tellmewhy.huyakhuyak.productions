import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, generateObject } from "ai";
import { z } from "zod";
import { getChatModel, getClassifierModel, getDigestModel, getExtractorModel, getTitleModel } from "./models";
import { thoughtRecordSchema } from "@/lib/exercises";
import { riskSchema } from "@/test/ai-fixtures";

describe("AI_MOCK production guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws at import time when AI_MOCK=1 and NODE_ENV=production", async () => {
    // AI_MOCK=1 is set globally in test setup; module-scope code only re-runs
    // on a fresh import, so force one via resetModules. vi.stubEnv (rather than
    // a direct assignment) sidesteps NODE_ENV's read-only type.
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    await expect(import("./models")).rejects.toThrow("AI_MOCK must not be enabled in production");
  });
});

describe("mock chat model (AI_MOCK=1 in test setup)", () => {
  it("returns deterministic text without network access", async () => {
    const { text } = await generateText({ model: getChatModel(), prompt: "hello" });
    expect(text).toContain("mock reply");
  });
});

describe("mock classifier model (AI_MOCK=1 in test setup)", () => {
  it("returns crisis when the prompt contains MOCK_CRISIS", async () => {
    const { object } = await generateObject({
      model: getClassifierModel(),
      schema: riskSchema,
      prompt: "MOCK_CRISIS something heavy",
    });
    expect(object.risk).toBe("crisis");
  });

  it("returns none for ordinary prompts", async () => {
    const { object } = await generateObject({
      model: getClassifierModel(),
      schema: riskSchema,
      prompt: "an ordinary day",
    });
    expect(object.risk).toBe("none");
  });
});

describe("mock digest model (AI_MOCK=1 in test setup)", () => {
  const digestSchema = z.object({
    overview: z.string(),
    themes: z.array(z.string()),
    anchors: z.array(z.object({ messageId: z.string(), label: z.string(), kind: z.enum(["moment", "risk"]) })),
  });

  it("returns a deterministic digest object without network access", async () => {
    const { object } = await generateObject({
      model: getDigestModel(),
      schema: digestSchema,
      prompt: "summarize this",
    });
    expect(object.overview).toBe("A mock digest overview.");
    expect(object.themes).toEqual(["mock theme"]);
    // No "[message <uuid>]" transcript marker in the prompt → no anchors.
    expect(object.anchors).toEqual([]);
  });

  it("echoes the first transcript message id back as a moment anchor", async () => {
    // The echoed id is real (it came from the transcript), so — unlike a
    // fabricated one — it survives the domain's hallucination filter, and an
    // offline e2e can click the anchor and land on the message.
    const first = "11111111-2222-3333-4444-555555555555";
    const { object } = await generateObject({
      model: getDigestModel(),
      schema: digestSchema,
      prompt: [
        `[message ${first}] client: I froze in the meeting`,
        "[message 99999999-8888-7777-6666-555555555555] assistant: a reply",
      ].join("\n"),
    });
    expect(object.anchors).toEqual([{ messageId: first, label: "A mock anchor", kind: "moment" }]);
  });
});

describe("mock extractor model (AI_MOCK=1 in test setup)", () => {
  it("returns a deterministic thought-record object without network access", async () => {
    const { object } = await generateObject({
      model: getExtractorModel(),
      schema: thoughtRecordSchema,
      prompt: "extract a thought record",
    });
    expect(object).toEqual({
      situation: "Mock situation",
      thoughts: "Mock thoughts",
      emotions: "Mock emotions",
      behavior: "Mock behavior",
    });
  });
});

describe("mock title model (AI_MOCK=1 in test setup)", () => {
  it("returns a deterministic mock title without network access", async () => {
    const { text } = await generateText({ model: getTitleModel(), prompt: "hello" });
    expect(text).toBe("A quiet mock title");
  });
});
