// Small, dependency-free text helpers shared across the app.

// Truncate by Unicode code points, never by UTF-16 units, so the cut can never
// split a surrogate pair (an emoji or astral glyph) into a broken half-character.
// `Array.from` iterates code points, so slicing it is surrogate-safe.
export function truncateToCodePoints(text: string, max: number): string {
  const codePoints = Array.from(text);
  return codePoints.length <= max ? text : codePoints.slice(0, max).join("");
}

// Fold free text into a shape safe to splice into an LLM prompt: normalize
// CRLF / lone CR to LF, cap any run of blank lines to a single one, and bound
// the length. A therapist-authored instruction is untrusted structure — this
// stops stray newlines from reshaping the prompt and stops a long run of blanks
// from ballooning it. Applied ONLY at interpolation time; stored ciphertext is
// never rewritten (encrypted history can't be retro-fixed, and storage is not
// where the prompt's shape is decided).
export function normalizeForPrompt(text: string, maxLength: number): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}
