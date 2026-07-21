// The auto-title budget, in Unicode code points (not UTF-16 code units).
const TITLE_CODEPOINT_LIMIT = 80;

/**
 * The auto-title call's output budget, in tokens.
 *
 * A title is 3-6 words, so this is deliberately far beyond what the answer
 * needs.
 * `max_tokens` is a RESERVATION ceiling, not a charge — billing follows actual
 * output either way — so headroom is free, and two failure modes make it
 * worth taking:
 *
 * - Uncapped, the AI SDK sends no `max_tokens` at all and the provider
 *   reserves the model's entire output window (65535 on the default model).
 *   OpenRouter then refuses the request upfront whenever the key's remaining
 *   credit can't cover a completion that large. That is exactly how every
 *   auto-title failed in production, leaving the composer's placeholder date
 *   as the conversation's name.
 * - Capped too tightly, a reasoning model spends the whole budget on thinking
 *   tokens (OpenRouter bills those against `max_tokens`) and returns empty
 *   text. The model here is env-swappable via `OPENROUTER_CLASSIFIER_MODEL`,
 *   and several natural swap targets think by default — so this must not be
 *   sized to the current default's behaviour alone. 1024 matches the budget
 *   every other capped call site in the codebase already uses, and is enough
 *   thinking room for even the chattier reasoning models.
 */
export const TITLE_MAX_OUTPUT_TOKENS = 1024;

/**
 * Clamp a generated title to `TITLE_CODEPOINT_LIMIT` code points.
 *
 * `text.slice(0, 80)` counts UTF-16 code units, not code points — an emoji
 * (or any character outside the BMP) is a surrogate pair worth two units, so
 * a naive slice can land mid-pair and cut it in half, leaving a lone
 * surrogate that renders as mojibake (or U+FFFD) wherever the title is
 * displayed. Spreading a string iterates by code point instead, so slicing
 * the resulting array always keeps whole characters.
 */
export function clampTitle(text: string): string {
  return [...text].slice(0, TITLE_CODEPOINT_LIMIT).join("");
}
