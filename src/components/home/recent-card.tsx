import Link from "next/link";

export type RecentItem = {
  id: string;
  title: string;
  /** null when the conversation is unsorted. */
  folderId: string | null;
  /** Resolved folder name, or null when unsorted. */
  folderName: string | null;
  updatedAt: Date;
};

// A calm, human "when" — never a jittery live counter. Runs on both the server
// and the client, so the minute-scale branch can disagree across hydration; the
// <time> below is marked suppressHydrationWarning to tolerate that gracefully.
function relativeTime(date: Date): string {
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

export function RecentCard({ item }: { item: RecentItem }) {
  return (
    <Link
      href={`/chat/${item.id}`}
      className="group flex h-full min-h-[112px] flex-col gap-2 rounded-[18px] border bg-card p-[18px] shadow-sm outline-none transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
    >
      {item.folderName ? (
        <div className="flex items-center">
          <span className="ml-auto whitespace-nowrap rounded-full border border-border/80 px-2 py-px text-[10px] text-muted-foreground">
            {item.folderName}
          </span>
        </div>
      ) : null}
      <span className="line-clamp-2 text-pretty text-[0.9rem] font-semibold tracking-[-0.005em]">
        {item.title}
      </span>
      <time
        suppressHydrationWarning
        className="mt-auto text-[11px] tabular-nums text-muted-foreground"
      >
        {relativeTime(item.updatedAt)}
      </time>
    </Link>
  );
}
