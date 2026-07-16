"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The version arrows under a branched message — ‹ n/m › between siblings.
// A message gains siblings when the person edits it (or regenerates an AI
// reply): each edit branches a new version from the same parent. This control
// walks between those versions by pointing the conversation's active leaf at a
// neighbouring sibling (the server lands on that branch's deepest continuation)
// and refreshing. Unlike the other quiet row actions it is ALWAYS visible when
// there's more than one version — a branch the reader can't see is a branch
// they can't return to.
export function VersionSwitcher({
  index,
  count,
  siblings,
  conversationId,
}: {
  /** This version's message id — always `siblings[index]`. Part of the mount
      contract (callers key the switcher by it); the control itself navigates
      by sibling id, so it isn't read here. */
  messageId: string;
  /** 0-based position of this version among its siblings. */
  index: number;
  /** How many versions the set holds (always > 1 where this renders). */
  count: number;
  /** The sibling ids in display order — the neighbours to switch to. */
  siblings: string[];
  conversationId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(targetId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/active-leaf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: targetId }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? "A gentle pace — give it a moment, then try again."
            : "Couldn't switch versions just now — try again.",
        );
        return;
      }
      // Server truth (the new active path) is the source of truth for what to
      // render — re-fetch it rather than guess the branch's continuation here.
      router.refresh();
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  const atStart = index <= 0;
  const atEnd = index >= count - 1;
  const arrowClass =
    "flex size-6 items-center justify-center rounded-md text-muted-foreground/70 outline-none transition-[color,transform] duration-150 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-30";

  return (
    <div className="mt-1 flex items-center gap-1 pr-1 text-[11px] text-muted-foreground/70">
      <button
        type="button"
        aria-label="Previous version"
        onClick={() => switchTo(siblings[index - 1]!)}
        disabled={busy || atStart}
        className={arrowClass}
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
          <path
            d="M10 3.5 5.5 8l4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span aria-hidden className="min-w-[2.2rem] text-center tabular-nums">
        {index + 1}/{count}
      </span>
      <span className="sr-only">
        Version {index + 1} of {count}
      </span>
      <button
        type="button"
        aria-label="Next version"
        onClick={() => switchTo(siblings[index + 1]!)}
        disabled={busy || atEnd}
        className={arrowClass}
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
          <path
            d="M6 3.5 10.5 8 6 12.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {error ? (
        <span role="alert" className="ml-1 font-serif text-[11px] italic text-accent">
          {error}
        </span>
      ) : null}
    </div>
  );
}
