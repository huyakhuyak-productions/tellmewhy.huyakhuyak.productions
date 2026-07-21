"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { InlineError } from "@/components/ui/inline-error";

// The token is the only thing this screen knows — no name, no email, nothing
// about the account it unlocks. An absent/rejected token (passed as `undefined`
// by the server page when better-auth reports "?error=INVALID_TOKEN") drops us
// straight into the honest "link no longer works" state, no field shown.
export function ResetPasswordForm({ token }: { token?: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  // When the success state swaps in, move focus to its heading so the change is
  // announced and keyboard focus isn't left on the vanished submit button.
  useEffect(() => {
    if (done) doneHeadingRef.current?.focus();
  }, [done]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      // A rejected token here means it expired or was already spent between the
      // page load and the submit — send them back to ask for a fresh one.
      if (error) return setError(error.message ?? "That reset link is no longer valid.");
      setDone(true);
    } catch {
      // Transport-level rejection (offline/DNS): the network dropped, not the
      // token — say so honestly rather than blaming a link that may be fine, and
      // never fake success here.
      setError("We couldn't reach the server just now — check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <main className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
        <div aria-hidden className="ambient-room" />
        <div className="flex flex-col gap-3">
          <h1 className="text-pretty font-serif text-[2rem] font-medium leading-[1.15] tracking-[-0.01em]">
            This link has expired
          </h1>
          <p className="text-pretty text-[0.975rem] leading-relaxed text-muted-foreground">
            Reset links last about an hour and can be used only once. Ask for a
            fresh one and we&rsquo;ll send it right over.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            <Link
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
              href="/forgot-password"
            >
              Send a new link
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div aria-hidden className="ambient-room" />
      {done ? (
        <div role="status" className="animate-message-rise flex flex-col gap-3">
          <h1
            ref={doneHeadingRef}
            tabIndex={-1}
            className="text-pretty font-serif text-[2rem] font-medium leading-[1.15] tracking-[-0.01em] outline-none"
          >
            Password updated
          </h1>
          <p className="text-pretty text-[0.975rem] leading-relaxed text-muted-foreground">
            You&rsquo;re all set. Sign in with your new password to pick up where
            you left off.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            <Link
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
              href="/sign-in"
            >
              Go to sign in
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-pretty font-serif text-[2rem] font-medium leading-[1.15] tracking-[-0.01em]">
              Set a new password
            </h1>
            <p className="text-pretty font-serif text-[1.05rem] italic text-muted-foreground">
              Choose something you&rsquo;ll remember next time.
            </p>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label htmlFor="reset-password" className="sr-only">
              New password
            </label>
            <input
              id="reset-password"
              className="h-12 rounded-xl border bg-card px-4 text-[0.975rem] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35"
              type="password"
              placeholder="New password (10+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
            {error ? <InlineError message={error} /> : null}
            <button
              className="mt-1 h-12 rounded-xl bg-accent font-medium text-accent-foreground shadow-sm outline-none transition-[transform,background-color,box-shadow] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
              disabled={pending}
            >
              {pending ? "Saving…" : "Save new password"}
            </button>
          </form>
          <p className="text-sm text-muted-foreground">
            Changed your mind?{" "}
            <Link
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
              href="/sign-in"
            >
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
