import { describe, expect, it } from "vitest";
import { generateText } from "ai";
import { getChatModel } from "./models";

describe("mock chat model (AI_MOCK=1 in test setup)", () => {
  it("returns deterministic text without network access", async () => {
    const { text } = await generateText({ model: getChatModel(), prompt: "hello" });
    expect(text).toContain("mock reply");
  });
});
