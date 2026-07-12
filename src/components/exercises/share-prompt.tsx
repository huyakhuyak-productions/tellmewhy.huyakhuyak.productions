"use client";

import { useEffect, useRef, useState } from "react";

// The one, non-coercive offer to share a just-saved assigned entry with the
// trusted person. It appears once, after a save, and only for an entry anchored
// to an assignment under a live link. Declining is final for this entry — the
// prompt resolves and never returns, so there is no nagging. Self-guided entries
// never reach here (the caller gates on both an exercise and an active link).
//
// Deliberately NOT a focus-trapping modal: a trap would read as pressure. It's a
// calm inline region that simply takes focus so a keyboard user lands on it.
export function SharePrompt({
  entryId,
  therapistName,
  onResolved,
}: {
  entryId: string;
  therapistName: string;
  // Called once the person has chosen — shared or kept private, success or the
  // person giving up on a failed share. Either way, this entry's prompt is done.
  onResolved: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regionRef = useRef<HTMLElement>(null);

  // Move focus onto the prompt when it appears so it's not missed — but without
  // trapping, so the person can tab straight past it if they'd rather not.
  useEffect(() => {
    regionRef.current?.focus();
  }, []);

  async function share() {
    if (sharing) return;
    setError(null);
    setSharing(true);
    try {
      const res = await fetch(`/api/entries/${entryId}/share`, { method: "POST" });
      if (!res.ok) {
        setError(
          res.status === 404
            ? "This connection has ended, so it can't be shared — it stays private with you."
            : "Couldn't share it just now — you can try again, or keep it private.",
        );
        return;
      }
      onResolved();
    } catch {
      setError("Couldn't share it just now — you can try again, or keep it private.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <section
      ref={regionRef}
      tabIndex={-1}
      role="group"
      aria-labelledby="share-prompt-copy"
      className="animate-message-rise flex flex-col gap-4 rounded-2xl border bg-card/60 p-5 outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
    >
      <p id="share-prompt-copy" className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-foreground">
        Share this entry with {therapistName}? You can keep it private — it still counts as done.
      </p>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={share}
          disabled={sharing}
          className="rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:opacity-50"
        >
          {sharing ? "Sharing…" : "Share this entry"}
        </button>
        <button
          type="button"
          onClick={onResolved}
          disabled={sharing}
          className="rounded-xl px-4 py-2.5 text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50"
        >
          Keep it private
        </button>
      </div>

      {error ? (
        <p role="alert" className="font-serif text-[12.5px] italic text-accent">
          {error}
        </p>
      ) : null}
    </section>
  );
}
