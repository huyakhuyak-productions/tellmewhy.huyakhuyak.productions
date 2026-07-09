"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ReadingMessage } from "@/lib/therapist-desk";
import { AttentionBadge } from "./attention-badge";

// The therapist reads a client's shared conversation. Read-only — the same
// bubbles/passages the client sees — with two deliberate acts layered on: a
// quiet "mark read to here" on every message, and an intervention composer
// that is unmistakably framed as the therapist speaking AS themselves, never
// as the AI.
export function ReadingView({
  conversationId,
  clientId,
  messages,
  markerMessageId,
}: {
  conversationId: string;
  clientId: string;
  messages: ReadingMessage[];
  markerMessageId: string | null;
}) {
  const router = useRouter();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function markReadTo(messageId: string) {
    if (markingId) return;
    setMarkingId(messageId);
    setMarkError(null);
    try {
      const res = await fetch(`/api/therapist/conversations/${conversationId}/review-marker`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      setMarkError("Couldn't move your review line — try again.");
    } catch {
      setMarkError("Couldn't move your review line — try again.");
    } finally {
      setMarkingId(null);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/therapist/conversations/${conversationId}/intervention`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setBody("");
        router.refresh();
        return;
      }
      setSendError(
        res.status === 429
          ? "A gentle pace — give it a moment, then try again. Your words are safe here."
          : "That didn't send. Your words are still here — try again.",
      );
    } catch {
      setSendError("That didn't send. Your words are still here — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-[22px]">
        {messages.length === 0 ? (
          <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
            This conversation is empty so far.
          </p>
        ) : (
          messages.map((m) => {
            if (m.sender === "system") {
              return (
                <p key={m.id} className="text-center text-[12px] italic text-muted-foreground/70">
                  {m.text}
                </p>
              );
            }
            const role = m.sender === "client" ? "user" : m.sender === "therapist" ? "therapist" : "assistant";
            const alignEnd = m.sender === "client";
            const isMarked = m.id === markerMessageId;
            return (
              <Fragment key={m.id}>
                <div className="group/msg flex flex-col gap-1.5">
                  <MessageBubble
                    role={role}
                    text={m.text}
                    authorName={m.sender === "therapist" ? (m.authorName ?? "You") : undefined}
                    authorRelation="you"
                  />
                  <div className={`flex items-center gap-2 ${alignEnd ? "justify-end" : "justify-start"}`}>
                    {(m.riskLevel === "crisis" || m.flagged) && (
                      <span className="flex gap-1.5">
                        {m.riskLevel === "crisis" ? <AttentionBadge kind="crisis" /> : null}
                        {m.flagged ? <AttentionBadge kind="flag" /> : null}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => markReadTo(m.id)}
                      disabled={markingId !== null}
                      aria-label="Mark read to here"
                      className="rounded-full px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color] duration-150 hover:bg-accent/10 hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/msg:opacity-100 disabled:opacity-40 [@media(pointer:coarse)]:opacity-100"
                    >
                      {isMarked ? "Reviewed to here" : "Mark read to here"}
                    </button>
                  </div>
                </div>
                {isMarked ? <ReviewDivider /> : null}
              </Fragment>
            );
          })
        )}
      </div>

      {markError ? (
        <p role="alert" className="mt-3 text-center font-serif text-[12.5px] italic text-crisis-muted">
          {markError}
        </p>
      ) : null}

      <form
        onSubmit={send}
        className="cp-notice mt-10 flex flex-col gap-2.5 rounded-2xl border px-5 py-4 shadow-sm"
      >
        <p className="text-[12.5px] font-medium text-foreground">
          This will appear as you — a human, not the AI.
        </p>
        {sendError ? (
          <p role="alert" className="font-serif text-[12.5px] italic leading-relaxed text-crisis-muted">
            {sendError}
          </p>
        ) : null}
        <textarea
          aria-label="Write a message as yourself"
          placeholder="Speak to them directly."
          value={body}
          maxLength={8000}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="min-h-[4.5rem] w-full resize-y rounded-xl border bg-card px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!body.trim() || sending}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,opacity,scale] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send as yourself"}
          </button>
        </div>
      </form>

      {/* Back to the client, echoed at the foot for the long-scroll reader.
          A client-side Link, not a plain <a> — a hard navigation here forces
          a fresh document load and hydration cycle right before the note
          composers below become interactive, which is exactly the kind of
          gap a fast typist (or a test) can race past. */}
      <div className="mt-6 text-center">
        <Link
          href={`/therapist/clients/${clientId}`}
          className="text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-accent focus-visible:text-accent"
        >
          Back to their conversations
        </Link>
      </div>
    </div>
  );
}

// The therapist's own review line, echoing the client-side divider: a quiet
// accent hairline, "reviewed up to here" — not an alarm.
function ReviewDivider() {
  return (
    <div role="separator" aria-label="Your review line" className="flex items-center gap-3">
      <span aria-hidden className="h-px flex-1 bg-accent/25" />
      <span className="whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.09em] text-accent/90">
        Reviewed up to here
      </span>
      <span aria-hidden className="h-px flex-1 bg-accent/25" />
    </div>
  );
}
