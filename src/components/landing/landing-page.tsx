import Link from "next/link";
import { PrivacySection } from "./privacy-section";
import { TrustedPersonSection } from "./trusted-person-section";
import { FaqSection } from "./faq-section";
import { JsonLd } from "./json-ld";

// The public front door, shown only to signed-out visitors. Server-rendered
// with no client JavaScript: the hero's entrance uses the app's own CSS
// `animate-message-rise`, and the FAQ is a native <details> disclosure. The
// whole page speaks the app's "twilight journal" language — Newsreader serif,
// the single periwinkle accent, hairline rules instead of cards.
export function LandingPage() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <JsonLd />
      <div aria-hidden className="ambient-room" />

      <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col gap-24 px-6 pb-24 pt-24 md:gap-28 md:pt-32">
        {/* Hero — the thesis: what this is, said plainly and honestly. */}
        <section className="flex flex-col gap-6">
          <span
            className="animate-message-rise text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
            style={{ animationDelay: "0ms" }}
          >
            tellmewhy
          </span>

          <h1
            className="animate-message-rise text-balance font-serif text-[2.4rem] font-medium leading-[1.08] tracking-[-0.02em] md:text-[3rem]"
            style={{ animationDelay: "70ms" }}
          >
            A private place to talk about how you feel.
          </h1>

          <p
            className="animate-message-rise max-w-prose text-pretty text-[1.05rem] leading-relaxed text-muted-foreground"
            style={{ animationDelay: "140ms" }}
          >
            Talk it through with an AI that answers now — and, if you ever want one, a single trusted
            person who can read only what you choose to share. Your words are encrypted the moment
            they&apos;re stored, and no one reads your words unless you decide they should.
          </p>

          <div
            className="animate-message-rise mt-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center"
            style={{ animationDelay: "210ms" }}
          >
            <Link
              href="/sign-up"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-7 font-medium text-accent-foreground shadow-sm outline-none transition-[transform,background-color,box-shadow] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.985]"
            >
              Create your space
            </Link>
            <Link
              href="/sign-in"
              className="text-sm text-muted-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:text-foreground hover:decoration-accent focus-visible:text-foreground"
            >
              Already have a space? Sign in
            </Link>
          </div>
        </section>

        <PrivacySection />
        <TrustedPersonSection />
        <FaqSection />

        {/* Closing invitation — quiet, one clear way in. */}
        <section className="flex flex-col items-start gap-5 border-t border-border/70 pt-12">
          <p className="text-balance font-serif text-[1.5rem] leading-[1.2] tracking-[-0.01em] md:text-[1.7rem]">
            Whenever you&apos;re ready, this space is yours.
          </p>
          <Link
            href="/sign-up"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-7 font-medium text-accent-foreground shadow-sm outline-none transition-[transform,background-color,box-shadow] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.985]"
          >
            Start talking
          </Link>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-6 pb-12">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 pt-6">
          <span className="font-serif text-[13px] italic text-muted-foreground">tellmewhy</span>
          <Link
            href="/sign-in"
            className="rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-accent focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-accent focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Create your space
          </Link>
        </div>
        <p className="max-w-prose text-pretty text-[12px] leading-relaxed text-muted-foreground/80">
          tellmewhy is not a medical device and not a substitute for professional care or emergency
          services. If you&apos;re in crisis, call 988 (US) or find a local line at findahelpline.com.
        </p>
      </footer>
    </div>
  );
}
