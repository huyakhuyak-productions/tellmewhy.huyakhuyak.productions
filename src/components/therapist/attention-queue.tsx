import Link from "next/link";
import { relativeTime } from "@/lib/relative-time";
import type { AttentionEntry } from "@/lib/therapist-desk";
import { AttentionBadge } from "./attention-badge";

// The dashboard's top zone: what has asked for the therapist today, crisis
// first. Quiet urgency — a warm-toned card and a soft label, never a wall of
// red. Each card reads like a note left on the desk and opens straight into
// the reading view at the client's words.
export function AttentionQueue({ entries }: { entries: AttentionEntry[] }) {
  return (
    <section aria-labelledby="attention-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="attention-heading" className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Asking for you
        </h2>
        {entries.length > 0 ? (
          <span className="text-[12px] tabular-nums text-muted-foreground/80">
            {entries.length} {entries.length === 1 ? "moment" : "moments"}
          </span>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <div className="cp-panel rounded-2xl border px-5 py-6">
          <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
            Nothing is asking for you right now. When someone flags a message or a hard moment
            surfaces, it will wait for you here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.messageId}>
              <Link
                href={`/therapist/conversations/${entry.conversationId}`}
                aria-label={`Read ${entry.clientName}'s conversation "${entry.conversationTitle}"`}
                className={`group block rounded-2xl border px-5 py-4 shadow-sm outline-none transition-[border-color,background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  entry.kind === "crisis"
                    ? "border-crisis-border bg-crisis/50 hover:bg-crisis/70"
                    : "cp-panel hover:border-accent/40"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <AttentionBadge kind={entry.kind} />
                  <time
                    suppressHydrationWarning
                    className="text-[11.5px] tabular-nums text-muted-foreground/80"
                  >
                    {relativeTime(entry.createdAt)}
                  </time>
                </div>
                <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-serif text-[1.05rem] text-foreground">{entry.clientName}</span>
                  <span className="text-[13px] text-muted-foreground">· {entry.conversationTitle}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-pretty text-[13.5px] leading-relaxed text-muted-foreground">
                  {entry.excerpt}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
