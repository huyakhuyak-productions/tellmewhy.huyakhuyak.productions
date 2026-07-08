"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { shareConversation, stopSharingConversation } from "@/lib/sharing-client";

// The conversation header's sharing affordance — the only place to share from
// on a phone (no rail there). Sharing is a single, clearly-labelled, reversible
// tap; the shared state reads as a calm indicator ("Shared with <name>") that
// opens a small menu to stop. Rendered only when an active link exists.
export function ShareControl({
  conversationId,
  shared,
  therapistName,
}: {
  conversationId: string;
  shared: boolean;
  therapistName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function share() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await shareConversation(conversationId);
    setBusy(false);
    if (ok) router.refresh();
    else setError("Couldn't share — try again.");
  }

  async function stop() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await stopSharingConversation(conversationId);
    setBusy(false);
    setMenuOpen(false);
    if (ok) router.refresh();
    else setError("Couldn't stop — try again.");
  }

  if (!shared) {
    return (
      <div className="flex items-center gap-2">
        {error ? (
          <span role="alert" className="font-serif text-[11px] italic text-accent">
            {error}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={`Share with ${therapistName}`}
          onClick={share}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:border-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50"
        >
          <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
            <path d="M11 5.5 6 8.5m5 3L6 8.5m8-4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM6 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm8 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {busy ? "Sharing…" : "Share"}
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        aria-label={`Shared with ${therapistName}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="flex max-w-[190px] items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.08] px-3 py-1.5 text-[12px] text-accent outline-none transition-[background-color] duration-150 hover:bg-accent/[0.12] focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]"
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0" aria-hidden>
          <path d="M3.5 8.5 6.5 11.5 12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="truncate">Shared with {therapistName}</span>
      </button>

      {menuOpen ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="animate-cp-pop absolute right-0 top-9 z-50 min-w-44 overflow-hidden rounded-xl border bg-card p-1 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_28px_-10px_rgba(0,0,0,0.25)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={stop}
              disabled={busy}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] disabled:opacity-50"
            >
              {busy ? "Stopping…" : "Stop sharing"}
            </button>
          </div>
        </>
      ) : null}

      {error ? (
        <span role="alert" className="ml-2 font-serif text-[11px] italic text-accent">
          {error}
        </span>
      ) : null}
    </div>
  );
}
