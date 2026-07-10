// Pure formatter for a homework assignment's engagement line — the "2 entries"
// half of "2 entries · last Tuesday". Kept free of any clock read: the caller
// resolves the relative "when" (via relativeTime) and renders it in its own
// <time>, so this stays deterministic and unit-testable. Counts ALL entries,
// shared or not — engagement, never content.
export function entryCountLabel(entryCount: number): string {
  if (entryCount <= 0) return "No entries yet";
  return entryCount === 1 ? "1 entry" : `${entryCount} entries`;
}
