// The auto-title budget, in Unicode code points (not UTF-16 code units).
const TITLE_CODEPOINT_LIMIT = 80;

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
