import Link from "next/link";

// The consulting-room shell every desk surface opens inside: a calm, centered
// reading measure with the nightlight glow the other "room" screens use, a
// persistent serif masthead ("The desk"), and an optional quiet way back. Not
// an admin chrome — a place to sit down and read.
export function DeskFrame({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** A quiet return path — rendered above the masthead. */
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 pb-24 pt-12 md:px-8 md:pt-16">
      <div aria-hidden className="ambient-room" />

      {/* A quiet way to the account, kept in the corner of every desk surface so
          it never competes with the reading. */}
      <Link
        href="/account"
        className="absolute right-5 top-5 inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 md:right-8 md:top-6"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 8.2a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4ZM3 13.2c0-2.2 2.2-3.6 5-3.6s5 1.4 5 3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Account
      </Link>

      <header className="flex flex-col gap-2.5">
        {back ? (
          <Link
            href={back.href}
            className="group inline-flex w-fit items-center gap-1.5 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent"
          >
            <svg viewBox="0 0 16 16" fill="none" className="size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden>
              <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {back.label}
          </Link>
        ) : null}

        {/* The masthead names the room only where there's no way back to it —
            on subpages the back link already says "The desk"/the client. */}
        {back ? null : (
          <p className="font-serif text-[13px] italic tracking-wide text-muted-foreground">The desk</p>
        )}
        <h1 className="text-balance font-serif text-[1.9rem] leading-[1.15] text-foreground md:text-[2.3rem]">
          {title}
        </h1>
        {subtitle ? (
          <p className="max-w-prose text-pretty text-[14px] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </header>

      <div className="mt-9 flex flex-col gap-9 md:mt-11 md:gap-11">{children}</div>
    </main>
  );
}
