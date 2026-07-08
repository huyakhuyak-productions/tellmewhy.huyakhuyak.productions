"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

// `next` is already sanitized to a same-origin path by the server page; after a
// successful sign-up we land there (e.g. an invite the person arrived through),
// and it is threaded onto the sign-in link so switching forms never drops it.
export function SignUpForm({ next }: { next?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const destination = next ?? "/chat";
  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({ name, email, password });
    setPending(false);
    if (error) return setError(error.message ?? "Something went wrong");
    router.push(destination);
  }

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div aria-hidden className="ambient-room" />
      <div className="flex flex-col gap-2">
        <h1 className="text-pretty font-serif text-[2rem] font-medium leading-[1.15] tracking-[-0.01em]">
          Create your space
        </h1>
        <p className="text-pretty font-serif text-[1.05rem] italic text-muted-foreground">
          A private place to talk about how you feel.
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="signup-name" className="sr-only">
          Your name
        </label>
        <input
          id="signup-name"
          className="h-12 rounded-xl border bg-card px-4 text-[0.975rem] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />
        <label htmlFor="signup-email" className="sr-only">
          Email
        </label>
        <input
          id="signup-email"
          className="h-12 rounded-xl border bg-card px-4 text-[0.975rem] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <label htmlFor="signup-password" className="sr-only">
          Password
        </label>
        <input
          id="signup-password"
          className="h-12 rounded-xl border bg-card px-4 text-[0.975rem] shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35"
          type="password"
          placeholder="Password (10+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
        />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button
          className="mt-1 h-12 rounded-xl bg-accent font-medium text-accent-foreground shadow-sm outline-none transition-[transform,background-color,box-shadow] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
          disabled={pending}
        >
          {pending ? "Creating…" : "Start talking"}
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Already here?{" "}
        <Link
          className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
          href={signInHref}
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
