import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

export type RiskLevel = "none" | "elevated" | "crisis";

const RANK: Record<RiskLevel, number> = { none: 0, elevated: 1, crisis: 2 };

// Fast-path patterns for explicit self-harm/suicidal intent. Deliberately
// high-precision: the LLM pass catches subtler phrasing; this floor makes
// sure the explicit cases can never be missed, even with the model down.
const CRISIS_PATTERNS: RegExp[] = [
  /\bkill(?:ing)? myself\b/i,
  /\bend(?:ing)? my (?:own )?life\b/i,
  /\bsuicid/i,
  /\bdon'?t want to (?:be alive|live|exist)\b/i,
  /\bwant(?:ing)? to die\b/i,
  /\bhurt(?:ing)? myself\b/i,
  /\bself[- ]harm/i,
  /\bno reason to (?:live|go on)\b/i,
];

export function screenText(text: string): RiskLevel {
  return CRISIS_PATTERNS.some((p) => p.test(text)) ? "crisis" : "none";
}

const riskSchema = z.object({ risk: z.enum(["none", "elevated", "crisis"]) });

export async function assessRisk(text: string, model: LanguageModel): Promise<RiskLevel> {
  const floor = screenText(text);
  try {
    const { object } = await generateObject({
      model,
      schema: riskSchema,
      abortSignal: AbortSignal.timeout(2500),
      system:
        "You are a safety classifier for a mental-health support chat. " +
        "Classify the user's message: 'crisis' = active self-harm or suicidal intent; " +
        "'elevated' = significant hopelessness or passive ideation worth extra care; " +
        "'none' = ordinary distress or everyday conversation. Respond with the classification only.",
      prompt: text,
    });
    return RANK[object.risk] > RANK[floor] ? object.risk : floor;
  } catch {
    return floor; // model unavailable — the regex floor still stands
  }
}
