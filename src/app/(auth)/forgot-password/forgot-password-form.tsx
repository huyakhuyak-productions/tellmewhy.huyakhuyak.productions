"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

// Password recovery is deliberately enumeration-free: every outcome — a real
// account, an unknown address, or a transport error — lands on the exact same
// calm confirmation, so the screen never reveals whether an email is registered.
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    // Fire the request and move on regardless of the result — we intentionally
    // ignore success vs. error so the confirmation cannot be used as an oracle.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    setSent(true);
  }

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div aria-hidden className="ambient-room" />
      {sent ? (
        <div className="animate-message-rise flex flex-col gap-3">
          <h1 className="text-pretty font-serif text-[2rem] font-medium leading-[1.15] tracking-[-0.01em]">
            Check your inbox
          </h1>
          <p className="text-pretty text-[0.975rem] leading-relaxed text-muted-foreground">
            If that address has an account, a reset link is on its way. It&rsquo;s
            good for about an hour.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            <Link
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
              href="/sign-in"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-pretty font-serif text-[2rem] font-medium leading-[1.15] tracking-[-0.01em]">
              Forgot your password?
            </h1>
            <p className="text-pretty font-serif text-[1.05rem] italic text-muted-foreground">
              Tell us your email and we&rsquo;ll send a way back in.
            </p>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label htmlFor="forgot-email" className="sr-only">
              Email
            </label>
            <input
              id="forgot-email"
              className="h-12 rounded-xl border bg-card px-4 text-[0.975rem] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <button
              className="mt-1 h-12 rounded-xl bg-accent font-medium text-accent-foreground shadow-sm outline-none transition-[transform,background-color,box-shadow] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
              disabled={pending}
            >
              {pending ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <p className="text-sm text-muted-foreground">
            Remembered it?{" "}
            <Link
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
              href="/sign-in"
            >
              Sign in
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
