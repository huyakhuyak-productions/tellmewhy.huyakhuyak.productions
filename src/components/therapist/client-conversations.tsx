import Link from "next/link";
import { relativeTime } from "@/lib/relative-time";
import type { ConversationForClientView } from "@/lib/therapist-desk";
import { AttentionBadge } from "./attention-badge";

// The conversations a client has shared with this therapist, each with a quiet
// unread-since-you-last-read count and any attention badges. A calm index into
// the reading view.
export function ClientConversations({
  conversations,
}: {
  conversations: ConversationForClientView[];
}) {
  return (
    <section aria-labelledby="conversations-heading" className="flex flex-col gap-4">
      <h2 id="conversations-heading" className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Shared conversations
      </h2>

      {conversations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 px-5 py-6">
          <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
            Nothing shared yet. When they share a conversation, it will open here for you to read.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {conversations.map((conv) => {
            const when = conv.lastMessageAt ?? conv.updatedAt;
            return (
              <li key={conv.id}>
                <Link
                  href={`/therapist/conversations/${conv.id}`}
                  aria-label={`Read "${conv.title}"`}
                  className="group flex flex-col gap-2 rounded-2xl border border-border/75 bg-card/55 px-5 py-4 outline-none transition-[border-color,background-color] duration-150 hover:border-accent/40 hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-serif text-[1.1rem] leading-snug text-foreground">{conv.title}</span>
                    <time suppressHydrationWarning className="mt-1 shrink-0 text-[11.5px] tabular-nums text-muted-foreground/80">
                      {relativeTime(when)}
                    </time>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {conv.unreadCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium tabular-nums text-accent">
                        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                        {conv.unreadCount} unread
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">Up to date</span>
                    )}
                    {conv.crisisCount > 0 ? <AttentionBadge kind="crisis" count={conv.crisisCount} /> : null}
                    {conv.flaggedCount > 0 ? <AttentionBadge kind="flag" count={conv.flaggedCount} /> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
