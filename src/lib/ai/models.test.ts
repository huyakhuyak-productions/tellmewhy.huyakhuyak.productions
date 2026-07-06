import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, generateObject } from "ai";
import { getChatModel, getClassifierModel, getTitleModel } from "./models";
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

describe("mock title model (AI_MOCK=1 in test setup)", () => {
  it("returns a deterministic mock title without network access", async () => {
    const { text } = await generateText({ model: getTitleModel(), prompt: "hello" });
    expect(text).toBe("A quiet mock title");
  });
});
