"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function currentGreeting(): string {
  const d = new Date();
  const h = d.getHours();
  const part =
    h < 5
      ? "Late night"
      : h < 12
        ? "This morning"
        : h < 17
          ? "This afternoon"
          : h < 21
            ? "This evening"
            : "Tonight";
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${part} · ${time}`;
}

// A quiet, time-aware eyebrow — the one flourish that makes the room feel lived
// in. Resolved a frame after mount so the server never guesses the reader's
// clock (no hydration mismatch) and it fades in rather than snapping.
function useGreeting() {
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGreeting(currentGreeting()));
    return () => cancelAnimationFrame(id);
  }, []);
  return greeting;
}

export function HeroComposer() {
  const router = useRouter();
  const greeting = useGreeting();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setError(null);
    setPending(true);
    let id: string;
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" }),
        }),
      });
      if (!res.ok) {
        setPending(false);
        // A rate-limit 429 carries its own calm copy; anything else (a 401
        // from a stale session, a 500) falls back to the generic message.
        const body: { error?: string } | null = await res.json().catch(() => null);
        return setError(body?.error ?? "Couldn't start the conversation — try again.");
      }
      // res.json() lives in this same try: a connection drop mid-body (after
      // headers land but before the response finishes streaming) throws here
      // too, and previously escaped uncaught — stranding `pending` at true
      // forever with the form locked and no error shown.
      ({ id } = await res.json());
    } catch {
      // Offline / network failure, or a mid-body drop while parsing the
      // response — same message either way so the form unlocks instead of
      // staying stuck on a request that never resolves.
      setPending(false);
      return setError("Couldn't start the conversation — try again.");
    }
    // Success path: `pending` stays true through sessionStorage/navigation so
    // a rapid second Enter can't fire a duplicate create — the component
    // unmounts when the route changes.
    // Never put message text in the URL — history and logs. ChatScreen reads
    // and clears this exact key on mount to send the first message.
    sessionStorage.setItem(`tellmewhy:draft:${id}`, text);
    router.push(`/chat/${id}`);
  }

  return (
    <section className="flex w-full max-w-[600px] flex-col items-center gap-5 text-center">
      <span
        className="h-4 text-[11px] uppercase tracking-[0.16em] tabular-nums text-muted-foreground transition-opacity duration-500"
        style={{ opacity: greeting ? 1 : 0 }}
        suppressHydrationWarning
      >
        {greeting ?? ""}
      </span>

      <h1 className="text-balance font-serif text-[1.7rem] font-medium leading-[1.35] tracking-[-0.015em] md:text-[1.95rem]">
        What&apos;s on your mind?
      </h1>

      <form onSubmit={submit} className="w-full">
        <div className="group flex w-full items-center gap-3 border-b-[1.5px] border-border px-0.5 pb-2.5 pt-0.5 transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:shadow-[0_0.5px_0_var(--accent)]">
          <input
            aria-label="Start a conversation"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
            placeholder="What's weighing on you today?"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent px-0.5 py-1 font-serif text-[19px] italic text-foreground outline-none placeholder:text-muted-foreground/85 disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={pending || draft.trim().length === 0}
            className="flex size-10 shrink-0 items-center justify-center rounded-[9px] text-muted-foreground outline-none transition-[color,transform] duration-150 hover:text-accent focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 group-focus-within:text-accent active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className={`size-[19px] ${pending ? "animate-pulse" : ""}`}
              aria-hidden
            >
              <path
                d="M4 10h11m0 0-4.5-4.5M15 10l-4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="mt-3 min-h-[1.1rem] text-[12px]">
          {error ? (
            <span role="alert" className="font-serif italic text-accent">
              {error}
            </span>
          ) : (
            <span className="text-muted-foreground">Everything here stays between us.</span>
          )}
        </div>
      </form>
    </section>
  );
}
