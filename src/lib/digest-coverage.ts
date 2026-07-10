// Pure helpers that let the reading view tell the therapist, honestly, how much
// of a conversation a session digest actually covers — never overclaiming. A
// digest is "stale" when newer messages have arrived since it was generated;
// these translate that into calm, exact prose. No DB, no clock — deterministic
// and unit-testable.

// How many messages arrived after the one the digest last covered. Returns null
// when the covered message is no longer in the conversation (e.g. deleted), so
// the caller can fall back to a generic line rather than invent a count.
export function countMessagesAfter(
  orderedMessageIds: string[],
  coversUpToMessageId: string,
): number | null {
  const idx = orderedMessageIds.indexOf(coversUpToMessageId);
  if (idx === -1) return null;
  return orderedMessageIds.length - 1 - idx;
}

// The one-line coverage note. Fresh digests say so plainly; stale ones say
// exactly how many newer messages haven't been folded in yet, so a therapist
// never mistakes an old summary for a current one.
export function coverageLine(stale: boolean, newerCount: number | null): string {
  if (!stale || newerCount === 0) {
    return "Covers the whole conversation, through the latest message.";
  }
  if (newerCount !== null && newerCount > 0) {
    return newerCount === 1
      ? "Covers up to an earlier message — 1 newer message hasn't been folded in yet."
      : `Covers up to an earlier message — ${newerCount} newer messages haven't been folded in yet.`;
  }
  return "Covers up to an earlier point — newer messages haven't been folded in yet.";
}
