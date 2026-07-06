export function CrisisBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-label="Support resources"
      className="animate-crisis-rise fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md overflow-hidden rounded-3xl border border-[color:var(--crisis-border)] bg-[color:var(--crisis)] p-5 text-[color:var(--crisis-foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_18px_48px_-12px_var(--crisis-glow)]"
    >
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 size-5 shrink-0 text-[color:var(--crisis-muted)]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <path
            d="M12 20.5S3.5 14.6 3.5 8.9A4.4 4.4 0 0 1 12 6.6a4.4 4.4 0 0 1 8.5 2.3c0 5.7-8.5 11.6-8.5 11.6Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="min-w-0">
          <p className="text-pretty font-medium leading-snug">
            It sounds like you&apos;re carrying something really heavy.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--crisis-muted)]">
            You deserve support from a real person, right now if you need it:
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li>
              <a
                className="font-medium underline decoration-[color:var(--crisis-border)] underline-offset-4 transition-[text-decoration-color] hover:decoration-[color:var(--crisis-muted)]"
                href="tel:988"
              >
                988 — Suicide &amp; Crisis Lifeline (US, call or text)
              </a>
            </li>
            <li>
              <a
                className="font-medium underline decoration-[color:var(--crisis-border)] underline-offset-4 transition-[text-decoration-color] hover:decoration-[color:var(--crisis-muted)]"
                href="https://findahelpline.com"
                target="_blank"
                rel="noreferrer"
              >
                findahelpline.com — international lines
              </a>
            </li>
            <li className="text-[color:var(--crisis-muted)]">
              If you&apos;re in immediate danger, call your local emergency number.
            </li>
          </ul>
        </div>
      </div>
      <button
        onClick={onDismiss}
        autoFocus
        className="mt-4 h-11 w-full rounded-xl border border-[color:var(--crisis-border)] bg-[color:var(--crisis)] text-sm font-medium outline-none transition-[transform,background-color] duration-150 hover:bg-[color:var(--crisis-border)]/40 focus-visible:ring-2 focus-visible:ring-[color:var(--crisis-muted)]/50 active:scale-[0.98]"
      >
        I&apos;m safe right now
      </button>
    </div>
  );
}
