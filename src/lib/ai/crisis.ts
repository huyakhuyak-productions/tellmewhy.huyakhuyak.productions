import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { errorCause } from "@/lib/errors";

export type RiskLevel = "none" | "elevated" | "crisis";

// A verdict is one enum word wrapped in a tiny JSON object. Without an
// explicit cap the AI SDK sends no max_tokens at all, so the provider reserves
// the model's ENTIRE output window (65535 tokens on the default classifier) —
// and OpenRouter refuses the request upfront whenever the key's remaining
// credit can't cover a completion that large. That failure mode disabled this
// whole raise-only layer in production, invisibly, for every message.
//
// Sized with headroom rather than to the byte — a truncated completion fails
// the structured-output JSON parse outright, dropping us back to the regex
// floor, the very outage this cap exists to end. For the full sizing rationale
// (reservation-ceiling semantics, reasoning-model thinking budgets, the
// env-swappable model) see TITLE_MAX_OUTPUT_TOKENS in lib/title.ts; the same
// reasoning applies here and both deliberately match the 1024 every other
// capped call site uses.
export const RISK_MAX_OUTPUT_TOKENS = 1024;

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
    // v6's non-deprecated structured-output API: `generateText` with
    // `Output.object` parses+validates the completion against the schema and
    // THROWS (NoObjectGeneratedError) on unparseable JSON or a schema
    // mismatch — the same failure mode the deprecated `generateObject` had, so
    // the regex-floor fallback below is untouched. The one gap it does NOT
    // throw on is a non-`stop` finish (truncation, content filter), where it
    // leaves `output` undefined; the guard treats that as a failed
    // classification so a partial reply can never masquerade as a verdict.
    const { output } = await generateText({
      model,
      output: Output.object({ schema: riskSchema }),
      maxOutputTokens: RISK_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(2500),
      system:
        "You are a safety classifier for a mental-health support chat. " +
        "Classify the user's message: 'crisis' = active self-harm or suicidal intent; " +
        "'elevated' = significant hopelessness or passive ideation worth extra care; " +
        "'none' = ordinary distress or everyday conversation. Respond with the classification only.",
      prompt: text,
    });
    if (!output) throw new Error("classifier returned no object");
    return RANK[output.risk] > RANK[floor] ? output.risk : floor;
  } catch (error) {
    // The regex floor still stands, so the chat is never blocked — but a
    // classifier that fails on EVERY message silently downgrades crisis
    // detection to patterns alone, which is precisely what happened before
    // the token cap above. Log it (never the raw error object: AI SDK errors
    // carry the request body — the classified message itself — as enumerable
    // own properties) so a dead safety layer is visible instead of invisible.
    console.error(`Failed to classify risk (${errorCause(error)})`);
    return floor;
  }
}
