// A calm, human "when" — never a jittery live counter. Runs on both the server
// and the client, so the minute-scale branch can disagree across hydration; any
// <time> that renders it should be marked suppressHydrationWarning to tolerate
// that gracefully.
export function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysApart = Math.floor((startOfToday.getTime() - date.getTime()) / 86_400_000);

  if (date.getTime() >= startOfToday.getTime()) return "Today";
  if (daysApart < 1) return "Yesterday";
  if (daysApart < 6) return date.toLocaleDateString(undefined, { weekday: "long" });

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
