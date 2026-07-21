"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { InlineError } from "@/components/ui/inline-error";

// Mirrors minPasswordLength in @/lib/auth — a local literal so this client
// component never imports the server auth module. The server is the real guard;
// this only caps the field and gives the button an honest disabled state.
const MIN_PASSWORD = 10;

// The account home: who you are, and three quiet, deliberate acts — leave this
// device, change your password, or close the account for good. Nothing here
// shouts. The gravest act (deletion) is the quietest of the three by design:
// two considered steps, the safe choice always under the cursor.
export function AccountScreen({ name, email }: { name: string; email: string }) {
  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-9 px-5 pb-24 pt-8 md:pt-14">
      <div aria-hidden className="ambient-room" />

      <div className="animate-message-rise flex flex-col gap-3">
        <Link
          href="/chat"
          className="inline-flex w-fit items-center gap-1.5 rounded-full py-1 pr-2 text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to your conversations
        </Link>
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Account
        </span>
        <h1 className="text-balance font-serif text-[1.9rem] font-medium leading-[1.2] tracking-[-0.01em]">
          Your account
        </h1>
        <div className="mt-1 flex flex-col gap-0.5">
          <p className="font-serif text-[1.05rem] leading-snug text-foreground">{name}</p>
          <p className="text-[13.5px] text-muted-foreground">{email}</p>
        </div>
      </div>

      <SignOutSection />
      <ChangePasswordSection />
      <DeleteAccountSection />
    </main>
  );
}

// The frame every act sits inside — a quiet card with a small eyebrow heading
// and a one-line description, staggered into place beneath the one above it.
function Section({
  eyebrow,
  description,
  delay,
  children,
}: {
  eyebrow: string;
  description: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className="animate-message-rise flex flex-col gap-4 rounded-2xl border bg-card/60 p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </h2>
        <p className="text-pretty font-serif text-[1.02rem] italic leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

// Leave this device. A plain hard-navigate home once the cookie is cleared —
// the session may already be gone, so a failed signOut still walks to "/".
function SignOutSection() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    try {
      await authClient.signOut();
    } catch {
      // The cookie clear is best-effort; either way we leave for the door.
    }
    window.location.href = "/";
  }

  return (
    <Section
      eyebrow="Sign out"
      description="Step away from this device. Everything you've written stays right here for when you're back."
      delay={40}
    >
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="w-fit rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </Section>
  );
}

// Change password: current + new (10+), revoking every other session so a
// changed password truly locks the old ones out. On success the form gives way
// to an honest confirmation, focus landing on its heading. Fields are never
// echoed anywhere but their own password inputs.
function ChangePasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  // When the confirmation swaps in, move focus to its heading so the change is
  // announced and focus isn't stranded on the vanished submit button.
  useEffect(() => {
    if (done) doneHeadingRef.current?.focus();
  }, [done]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (next.length < MIN_PASSWORD) {
      setError(`Your new password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (error) {
        // Always the house line — never echo the raw server error.message. A
        // verbatim server string can be noisy, shifting, or faintly enumerating;
        // the transport-catch branch below already speaks in this same voice.
        setError("That didn't work — check your current password and try again.");
        return;
      }
      setCurrent("");
      setNext("");
      setDone(true);
    } catch {
      // Transport-level failure — surface the calm copy rather than faking
      // success or stranding "Saving…".
      setError("That didn't work just now — try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Section
        eyebrow="Change password"
        description="Keep it something only you would think of."
        delay={90}
      >
        <div role="status" className="flex flex-col gap-3">
          <h3
            ref={doneHeadingRef}
            tabIndex={-1}
            className="font-serif text-[1.15rem] leading-snug text-foreground outline-none"
          >
            Your password is changed.
          </h3>
          <p className="text-pretty font-serif text-[0.98rem] italic leading-relaxed text-muted-foreground">
            Every other signed-in device has been signed out. This one stays with you.
          </p>
          <button
            type="button"
            onClick={() => setDone(false)}
            className="w-fit rounded-lg px-1 py-1 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent"
          >
            Change it again
          </button>
        </div>
      </Section>
    );
  }

  return (
    <Section
      eyebrow="Change password"
      description="Keep it something only you would think of."
      delay={90}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
        <label htmlFor="account-current-password" className="sr-only">
          Current password
        </label>
        <input
          id="account-current-password"
          className="h-11 rounded-xl border bg-card px-3.5 text-[0.95rem] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          type="password"
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
        <label htmlFor="account-new-password" className="sr-only">
          New password
        </label>
        <input
          id="account-new-password"
          className="h-11 rounded-xl border bg-card px-3.5 text-[0.95rem] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          type="password"
          placeholder="New password (10+ characters)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
        />
        {error ? <InlineError message={error} /> : null}
        <button
          type="submit"
          disabled={pending || current.length === 0 || next.length < MIN_PASSWORD}
          className="mt-1 w-fit rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? "Updating…" : "Update password"}
        </button>
      </form>
    </Section>
  );
}

type DeleteStep = "idle" | "password" | "confirm";

// The grave act, kept quiet. Three considered states: a resting door, a
// password check, then a plain-spoken acknowledgment of exactly what leaves and
// what stays — the safe choice ("Keep my account") always under the cursor. A
// 204 clears the cookie and walks to /goodbye; a 400/429 stays calm and inline.
function DeleteAccountSection() {
  const [step, setStep] = useState<DeleteStep>("idle");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  // On the acknowledgment step land focus on the safe action in one hop, so a
  // keyboard user never fires the delete by reflex. Focus lands directly here
  // (no intermediate stop on the heading) so it doesn't clip the screen-reader
  // announcement of the role="status" region's grave copy below — the delete
  // button's aria-describedby covers that copy for anyone tabbing straight to it.
  useEffect(() => {
    if (step === "confirm") keepRef.current?.focus();
  }, [step]);

  function reset() {
    setStep("idle");
    setPassword("");
    setError(null);
  }

  function toConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (password.length === 0) return;
    setError(null);
    setStep("confirm");
  }

  async function remove() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 204) {
        // The server session is already gone; signOut just clears the cookie.
        await authClient.signOut().catch(() => {});
        window.location.href = "/goodbye";
        return;
      }
      if (res.status === 429) {
        setError("Slow down a little — wait a moment, then try again.");
      } else if (res.status === 400) {
        setError("That password doesn't match. Nothing has been deleted.");
        // The rejected password must not ride back into the confirm step —
        // clear it so a re-submit can't loop on a password already known wrong.
        setPassword("");
      } else {
        setError("Something went wrong — nothing has been deleted. Try again in a moment.");
      }
      // A wrong password or throttle sends them back to re-enter it, rather than
      // stranding the acknowledgment step over a stale, rejected password.
      setStep("password");
    } catch {
      setError("Something went wrong — nothing has been deleted. Try again in a moment.");
      setStep("password");
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      eyebrow="Delete account"
      description="Close this account for good. This one can't be undone."
      delay={140}
    >
      {step === "idle" ? (
        <button
          type="button"
          onClick={() => setStep("password")}
          className="w-fit rounded-xl border px-4 py-2.5 text-[13px] text-muted-foreground outline-none transition-[color,border-color] duration-150 hover:border-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]"
        >
          Delete my account
        </button>
      ) : null}

      {step === "password" ? (
        <form onSubmit={toConfirm} className="flex flex-col gap-2.5">
          <label htmlFor="account-delete-password" className="sr-only">
            Your password
          </label>
          <input
            id="account-delete-password"
            autoFocus
            className="h-11 rounded-xl border bg-card px-3.5 text-[0.95rem] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            type="password"
            placeholder="Enter your password to continue"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          {error ? <InlineError message={error} /> : null}
          <div className="mt-1 flex items-center gap-2">
            <button
              type="submit"
              disabled={password.length === 0}
              className="rounded-xl border px-4 py-2.5 text-[13px] text-muted-foreground outline-none transition-[color,border-color] duration-150 hover:border-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-xl px-3 py-2.5 text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {step === "confirm" ? (
        <div role="status" className="flex flex-col gap-3.5">
          <h3 className="font-serif text-[1.15rem] leading-snug text-foreground">
            Are you sure you want to leave for good?
          </h3>
          <div
            id="account-delete-acknowledgment"
            className="flex flex-col gap-2.5 text-pretty font-serif text-[0.98rem] leading-relaxed text-muted-foreground"
          >
            <p>
              Your conversations, notes, check-ins and records will be gone — we can&apos;t
              bring them back, and neither can anyone else.
            </p>
            <p>
              A few audit lines about the account itself remain, and a therapist you&apos;ve
              linked with keeps their own notes and will see that you left.
            </p>
          </div>
          {error ? <InlineError message={error} /> : null}
          <div className="mt-1 flex items-center gap-2">
            <button
              ref={keepRef}
              type="button"
              onClick={reset}
              disabled={pending}
              className="rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              Keep my account
            </button>
            {/* The committing action, kept deliberately quiet: a bordered
                button carrying a single warm hairline (the crisis border, used
                this sparingly and nowhere else here) — grave, never an alarm. */}
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              aria-describedby="account-delete-acknowledgment"
              className="rounded-xl border border-[color:var(--crisis-border)] px-4 py-2.5 text-[13px] text-muted-foreground outline-none transition-[color,background-color] duration-150 hover:bg-[color:var(--crisis)]/40 hover:text-[color:var(--crisis-foreground)] focus-visible:ring-2 focus-visible:ring-[color:var(--crisis-muted)]/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Delete everything"}
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
