// Small, dependency-free text helpers shared across the app.

// Truncate by Unicode code points, never by UTF-16 units, so the cut can never
// split a surrogate pair (an emoji or astral glyph) into a broken half-character.
// `Array.from` iterates code points, so slicing it is surrogate-safe.
export function truncateToCodePoints(text: string, max: number): string {
  const codePoints = Array.from(text);
  return codePoints.length <= max ? text : codePoints.slice(0, max).join("");
}
