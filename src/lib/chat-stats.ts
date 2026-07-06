const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ChatStats = {
  total: number;
  thisWeek: number;
  memberSince: Date;
};

// Derive the quiet right-rail stats from the conversation list. Kept out of the
// page body so the `Date.now()` read isn't flagged as an impure render call.
export function deriveChatStats(
  conversations: { updatedAt: Date }[],
  memberSince: Date,
): ChatStats {
  const now = Date.now();
  return {
    total: conversations.length,
    thisWeek: conversations.filter((c) => now - c.updatedAt.getTime() < WEEK_MS).length,
    memberSince,
  };
}
