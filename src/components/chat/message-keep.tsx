"use client";

import { useState } from "react";

// The quiet "keep this" gesture — a line worth remembering, set aside for the
// next hard night. Works on the person's own words and the AI's alike, and is
// entirely private: keeping never shares anything with anyone.
export function MessageKeep({ messageId, initialKept }: { messageId: string; initialKept: boolean }) {
  const [kept, setKept] = useState(initialKept);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function keep() {
    if (busy || kept) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) {
        setError("Couldn't keep that just now — try again.");
        return;
      }
      setKept(true);
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (kept) {
    return (
      <div className="mt-1 flex items-center gap-1.5 pr-1 text-[11px] text-accent/90">
        <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden>
          <path d="M4 2.5h8v11l-4-3-4 3v-11Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Kept for your future self
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2 pr-1">
      {error ? (
        <span role="alert" className="font-serif text-[11px] italic text-accent">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Keep this for your future self"
        onClick={keep}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground/70 opacity-0 outline-none transition-[opacity,color] duration-150 hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/msg:opacity-100 disabled:opacity-40"
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden>
          <path d="M4 2.5h8v11l-4-3-4 3v-11Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Keep this
      </button>
    </div>
  );
}
