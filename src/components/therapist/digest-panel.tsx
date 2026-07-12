"use client";

import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { countMessagesAfter, coverageLine } from "@/lib/digest-coverage";

// The AI's read of a shared conversation, offered at the top of the reading
// view — never forced. It opens as one calm collapsed line and expands on the
// therapist's ask. The fetch fires on open (generation can take seconds), so
// the line reads "Preparing digest…" until it resolves, then becomes the real
// summary the therapist can unfold. Every state here is honest: a stale digest
// says exactly what it still covers, and an unavailable one says so plainly
// rather than inventing a summary.

// The digest as it crosses the wire — generatedAt is an ISO string over JSON,
// not a Date (we never render it, so it stays a string).
type FetchedDigest = {
  overview: string;
  themes: string[];
  anchors: { messageId: string; label: string; kind: "moment" | "risk" }[];
  coversUpToMessageId: string;
  generatedAt: string;
  stale: boolean;
};

type Status = "loading" | "ready";

// The digest overview is AI-generated prose, so it renders through a markdown
// library (never as a raw string) — the same Streamdown the notes panel uses.
const prose =
  "font-serif text-[14px] leading-[1.6] text-pretty text-foreground [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_em]:italic [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-[0.5em] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5";

export function DigestPanel({
  conversationId,
  orderedMessageIds,
  onJumpToMessage,
}: {
  conversationId: string;
  /** Every message id in render order — lets a stale digest count exactly how
      many newer messages haven't been folded in. */
  orderedMessageIds: string[];
  /** Reuses the reading view's crisis-navigator landing: scroll + gentle flash. */
  onJumpToMessage: (messageId: string) => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [digest, setDigest] = useState<FetchedDigest | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/therapist/conversations/${conversationId}/digest`);
        if (!res.ok) {
          if (!cancelled) {
            setDigest(null);
            setStatus("ready");
          }
          return;
        }
        const data = (await res.json()) as { digest: FetchedDigest | null };
        if (!cancelled) {
          setDigest(data.digest ?? null);
          setStatus("ready");
        }
      } catch {
        // Never fabricate — a failed fetch is the same honest "unavailable".
        if (!cancelled) {
          setDigest(null);
          setStatus("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const coverage = useMemo(() => {
    if (!digest) return null;
    const newer = countMessagesAfter(orderedMessageIds, digest.coversUpToMessageId);
    // "Not current" only when the digest is stale AND newer messages genuinely
    // remain — a stale digest that self-healed (0 newer) is effectively current.
    const notCurrent = digest.stale && newer !== 0;
    return { line: coverageLine(digest.stale, newer), notCurrent };
  }, [digest, orderedMessageIds]);

  const hasContent = status === "ready" && digest !== null;

  // The one collapsed line, by state: preparing → the summary title → unavailable.
  const title =
    status === "loading"
      ? "Preparing digest…"
      : digest
        ? "Session digest"
        : "Digest unavailable right now";

  // The header's inner layout — spark, live status line, coverage, chevron —
  // shared by both the interactive (has-content) and the plain-status headers.
  const headerContent = (
    <>
      <SparkIcon loading={status === "loading"} />
      <span className="flex-1">
        <span className="flex items-center gap-2">
          <span
            aria-live="polite"
            className={`text-[13px] font-medium text-foreground ${status === "loading" ? "motion-safe:animate-pulse" : ""}`}
          >
            {title}
          </span>
          {coverage?.notCurrent ? (
            <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
              Not current
            </span>
          ) : null}
        </span>
        {hasContent && coverage ? (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            {coverage.line}
          </span>
        ) : null}
      </span>
      {hasContent ? (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </>
  );

  return (
    <section
      aria-label="Session digest"
      className="mb-8 overflow-hidden rounded-2xl border border-border/75 bg-card/50"
    >
      {/* When there's a real digest the header is the disclosure control; when
          it's still preparing or genuinely unavailable it's plain status text,
          never a dead disabled button. The aria-live span carries the state
          either way. */}
      {hasContent ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="digest-body"
          className="group flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-accent/[0.04] focus-visible:bg-accent/[0.05]"
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 px-4 py-3 text-left">{headerContent}</div>
      )}

      {hasContent && digest ? (
        <div
          id="digest-body"
          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-4 border-t border-border/60 px-4 pb-4 pt-3.5">
              {digest.overview.trim() ? (
                <div className={prose}>
                  <Streamdown>{digest.overview}</Streamdown>
                </div>
              ) : null}

              {digest.themes.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                    Themes
                  </span>
                  <ul className="flex flex-wrap gap-1.5">
                    {digest.themes.map((theme, i) => (
                      <li
                        key={`${theme}-${i}`}
                        className="rounded-full border border-accent/20 bg-accent/[0.07] px-2.5 py-0.5 text-[11.5px] text-accent/90"
                      >
                        {theme}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {digest.anchors.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                    Jump to
                  </span>
                  <ul className="flex flex-col gap-1.5">
                    {digest.anchors.map((anchor) => (
                      <li key={anchor.messageId}>
                        <AnchorLink anchor={anchor} onJump={() => onJumpToMessage(anchor.messageId)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// A digest anchor as a jump control. A "risk" anchor wears the warm-amber crisis
// treatment — the same grounding palette the navigator and attention queue
// speak in, never a red alarm. A "moment" anchor stays in the quiet accent.
function AnchorLink({
  anchor,
  onJump,
}: {
  anchor: { label: string; kind: "moment" | "risk" };
  onJump: () => void;
}) {
  const isRisk = anchor.kind === "risk";
  const tone = isRisk
    ? "border-crisis-border bg-crisis text-crisis-foreground hover:bg-crisis focus-visible:ring-crisis-muted/50"
    : "border-accent/20 bg-accent/[0.05] text-foreground hover:border-accent/40 hover:bg-accent/[0.08] focus-visible:ring-accent/40";
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Jump to ${isRisk ? "a crisis moment" : "a moment"}: ${anchor.label}`}
      className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12.5px] leading-snug outline-none transition-[background-color,border-color,scale] duration-150 focus-visible:ring-2 active:scale-[0.99] ${tone}`}
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${isRisk ? "bg-crisis-muted" : "bg-accent"}`}
      />
      <span className="min-w-0 flex-1 truncate">{anchor.label}</span>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden className="size-3.5 shrink-0 opacity-60">
        <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// A quiet four-point spark — the "an AI read this" mark. Softly pulses only
// while the digest is being prepared, and only when motion is allowed.
function SparkIcon({ loading }: { loading: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={`size-4 shrink-0 text-accent/80 ${loading ? "motion-safe:animate-pulse" : ""}`}
    >
      <path
        d="M8 1.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z"
        fill="currentColor"
      />
    </svg>
  );
}
