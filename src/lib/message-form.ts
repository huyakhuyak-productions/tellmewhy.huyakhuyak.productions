// Deterministic long-form rule shared by every viewport: long messages
// render as passages/panels instead of bubbles. Thresholds are a product
// decision (spec 2026-07-06) — change them there first.
const LONG_FORM_CHAR_THRESHOLD = 280;

export function isLongForm(text: string): boolean {
  if (text.length > LONG_FORM_CHAR_THRESHOLD) return true;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return paragraphs.length >= 2;
}
