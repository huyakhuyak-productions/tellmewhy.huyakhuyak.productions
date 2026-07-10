"use client";

import { relativeTime } from "@/lib/relative-time";
import type { ThoughtRecordPayload } from "@/lib/thought-record-draft";

export type PastEntry = {
  id: string;
  /** Non-null means the entry answers an assignment (so it can have been shared). */
  exerciseId: string | null;
  payload: ThoughtRecordPayload;
  sharedAt: Date | null;
  createdAt: Date;
};

// The person's own record of records — read-only, most recent first. Each card
// leads with the situation (the anchor of the memory), carries what they felt
// beneath it, and marks quietly if the entry was shared. A self-guided entry can
// never be shared, so it never carries the mark.
export function EntryList({ entries }: { entries: PastEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-pretty font-serif text-[0.95rem] italic leading-relaxed text-muted-foreground">
        Nothing here yet. When you finish a thought record, it&apos;ll wait for you here — private unless you share it.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-col gap-1.5 rounded-2xl border bg-card/60 p-4"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 flex-1 text-pretty font-serif text-[0.98rem] leading-snug text-foreground">
              {entry.payload.situation}
            </p>
            <time
              suppressHydrationWarning
              className="shrink-0 pt-px text-[11.5px] tabular-nums text-muted-foreground/80"
            >
              {entry.payload.occurredAt?.trim() || relativeTime(entry.createdAt)}
            </time>
          </div>
          {entry.payload.emotions.trim() ? (
            <p className="text-pretty text-[12.5px] leading-relaxed text-muted-foreground">
              {entry.payload.emotions}
            </p>
          ) : null}
          {entry.sharedAt ? (
            <span className="mt-0.5 inline-flex w-fit items-center gap-1.5 text-[11px] text-accent/90">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 1.8 3 4v3.5c0 3 2.1 5.2 5 6.7 2.9-1.5 5-3.7 5-6.7V4L8 1.8Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Shared with your therapist
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
