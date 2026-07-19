import type { Metadata } from "next";
import Link from "next/link";

// Public and static — the last screen someone sees after closing their account,
// reachable with no session (the cookie is already cleared by the time we land
// here). No sign-in wall, no upsell: just an honest goodbye and an open door.
export const metadata: Metadata = {
  title: "Goodbye — tellmewhy",
  robots: { index: false, follow: false },
};

// Rendered per request (not statically prerendered) so the root layout reads
// the Umami env at runtime — Dokku config isn't in scope at image-build time,
// and a baked-empty static page would silently ship no analytics script.
export const dynamic = "force-dynamic";

export default function GoodbyePage() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div aria-hidden className="ambient-room" />

      <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center gap-5 px-6 py-16">
        <div className="animate-message-rise flex flex-col gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Your account is closed
          </span>
          <h1 className="text-balance font-serif text-[2rem] font-medium leading-[1.15] tracking-[-0.01em]">
            Take care of yourself.
          </h1>
        </div>
        <div
          className="animate-message-rise flex flex-col gap-3 text-pretty font-serif text-[1.05rem] leading-relaxed text-muted-foreground"
          style={{ animationDelay: "60ms" }}
        >
          <p>
            Everything you wrote here has been deleted. Thank you for trusting this
            space with it, however long you needed it.
          </p>
          <p>The door stays open. If you ever want to come back, you&apos;re welcome to.</p>
        </div>
        <p className="animate-message-rise mt-1" style={{ animationDelay: "120ms" }}>
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-1.5 rounded-full text-[13.5px] text-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Start a new space
          </Link>
        </p>
      </main>

      <footer className="mx-auto w-full max-w-[520px] px-6 pb-12">
        <p className="text-pretty text-[12px] leading-relaxed text-muted-foreground/80">
          tellmewhy is not a medical device and not a substitute for professional care or emergency
          services. If you&apos;re in crisis, call 988 (US) or find a local line at findahelpline.com.
        </p>
      </footer>
    </div>
  );
}
