"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "accepting" | "accepted";

// The person is already signed in by the time this renders (the server page
// bounced them through sign-in otherwise), so accepting is a single deliberate
// press. We never preview who invited them — there's no token-preview surface,
// and guessing would be worse than honest generality. The module's own
// business-rule messages (expired, already used, your own invite, already
// linked) are shown verbatim but calmly, never as an alarm.
export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (phase !== "idle") return;
    setError(null);
    setPhase("accepting");
    try {
      const res = await fetch("/api/links/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body: { error?: string } | null = await res.json().catch(() => null);
        setError(body?.error ?? "This invitation couldn't be opened.");
        setPhase("idle");
        return;
      }
      setPhase("accepted");
      // A beat on the confirmation, then home. The connection is live server-
      // side already; this pause is just so the acceptance registers as real.
      setTimeout(() => router.push("/chat"), 1100);
    } catch {
      setError("This invitation couldn't be opened — check your connection and try again.");
      setPhase("idle");
    }
  }

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div aria-hidden className="ambient-room" />

      <div className="animate-message-rise flex flex-col gap-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          An invitation
        </span>
        <h1 className="text-balance font-serif text-[1.9rem] font-medium leading-[1.2] tracking-[-0.01em]">
          You&apos;ve been asked to be someone&apos;s trusted person
        </h1>
        <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
          On tellmewhy, a trusted person can gently review the conversations
          someone chooses to share with them — and nothing else. You&apos;ll only
          ever see what they hand to you, and they can stop sharing at any time.
        </p>
      </div>

      {phase === "accepted" ? (
        <div
          role="status"
          className="animate-message-rise cp-panel flex items-center gap-3 rounded-2xl border px-5 py-4"
        >
          <svg viewBox="0 0 20 20" fill="none" className="size-5 shrink-0 text-accent" aria-hidden>
            <path
              d="M4 10.5 8 14.5 16 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="font-serif text-[1rem] italic text-foreground">
            You&apos;re connected. Taking you in…
          </p>
        </div>
      ) : (
        <div className="animate-message-rise flex flex-col gap-3" style={{ animationDelay: "80ms" }}>
          <button
            type="button"
            onClick={accept}
            disabled={phase === "accepting"}
            className="h-12 rounded-xl bg-accent font-medium text-accent-foreground shadow-sm outline-none transition-[transform,background-color,box-shadow] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
          >
            {phase === "accepting" ? "Accepting…" : "Accept invitation"}
          </button>
          {error ? (
            <p role="alert" className="cp-notice rounded-xl border px-4 py-2.5 font-serif text-[0.9rem] italic leading-relaxed text-muted-foreground">
              {error}
            </p>
          ) : (
            <p className="px-1 text-[12px] text-muted-foreground">
              Only accept if you know who invited you.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
