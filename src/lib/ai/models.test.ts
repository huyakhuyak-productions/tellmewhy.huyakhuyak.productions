import { describe, expect, it } from "vitest";
import { generateText, generateObject } from "ai";
import { z } from "zod";
import { getChatModel, getClassifierModel } from "./models";

describe("mock chat model (AI_MOCK=1 in test setup)", () => {
  it("returns deterministic text without network access", async () => {
    const { text } = await generateText({ model: getChatModel(), prompt: "hello" });
    expect(text).toContain("mock reply");
  });
});

const riskSchema = z.object({ risk: z.enum(["none", "elevated", "crisis"]) });

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
