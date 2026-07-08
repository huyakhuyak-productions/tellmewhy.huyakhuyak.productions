"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { shareConversation } from "@/lib/sharing-client";

// The "flag for my therapist" affordance under a client's own message. A flag
// is a quiet marker the person leaves for their trusted person — it persists
// whether or not the conversation is shared yet (the server waits until it is),
// but flagging in an unshared conversation would do nothing visible, so we stop
// and offer to share first rather than let the gesture vanish into nowhere.
export function MessageFlag({
  conversationId,
  messageId,
  initialFlagged,
  shared,
  therapistName,
}: {
  conversationId: string;
  messageId: string;
  initialFlagged: boolean;
  shared: boolean;
  therapistName: string;
}) {
  const router = useRouter();
  const [flagged, setFlagged] = useState(initialFlagged);
  const [prompting, setPrompting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doFlag(alsoShare: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (alsoShare) {
        const ok = await shareConversation(conversationId);
        if (!ok) {
          setError("Couldn't share just now — try again.");
          return;
        }
      }
      const res = await fetch(`/api/messages/${messageId}/flag`, { method: "POST" });
      if (!res.ok) {
        setError("Couldn't flag just now — try again.");
        return;
      }
      setFlagged(true);
      setPrompting(false);
      router.refresh();
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (flagged) {
    // Honest tense: once sharing stops, the flag still exists server-side but
    // the therapist can no longer see it — the badge must not keep asserting
    // present visibility. Re-sharing makes it visible again (and the label
    // follows), no extra data needed.
    return (
      <div className="ml-auto mt-1 flex items-center gap-1.5 pr-1 text-[11px] text-accent/90">
        <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden>
          <path d="M4 2.5v11M4 3h7l-1.4 2.4L11 8H4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {shared ? "Flagged for your therapist" : "Flagged — not currently shared"}
      </div>
    );
  }

  if (prompting) {
    return (
      <div className="cp-notice ml-auto mt-1.5 flex max-w-[88%] flex-col gap-2 rounded-xl border px-3.5 py-2.5">
        <p className="font-serif text-[0.85rem] italic leading-relaxed text-muted-foreground">
          This conversation isn&apos;t shared yet, so {therapistName} wouldn&apos;t
          see a flag. Share it now?
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => doFlag(true)}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:opacity-50"
          >
            {busy ? "Sharing…" : "Share and flag"}
          </button>
          <button
            type="button"
            onClick={() => setPrompting(false)}
            disabled={busy}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Not now
          </button>
        </div>
        {error ? (
          <span role="alert" className="font-serif text-[11.5px] italic text-accent">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ml-auto mt-1 flex items-center gap-2 pr-1">
      {error ? (
        <span role="alert" className="font-serif text-[11px] italic text-accent">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Flag for my therapist"
        onClick={() => (shared ? doFlag(false) : setPrompting(true))}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground/70 opacity-0 outline-none transition-[opacity,color] duration-150 hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/msg:opacity-100 disabled:opacity-40"
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden>
          <path d="M4 2.5v11M4 3h7l-1.4 2.4L11 8H4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Flag for my therapist
      </button>
    </div>
  );
}
