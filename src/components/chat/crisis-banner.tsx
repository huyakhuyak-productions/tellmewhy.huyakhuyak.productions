"use client";

import { useEffect, useRef, useState } from "react";
import { wrapFocus } from "@/lib/focus-trap";

export function CrisisBanner({ onDismiss }: { onDismiss: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  // The overlay variant (phones) floats over the whole screen, so it behaves
  // as a modal dialog. The lg variant is docked in the reading column beside
  // the composer and messages — content around it stays live, so claiming
  // `aria-modal` there would lie to assistive tech. Track which variant is on.
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const sync = () => setOverlay(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Modal focus management — overlay variant only. The docked lg card is
  // deliberately non-modal (no aria-modal above): the composer and messages
  // around it stay live, so stealing focus on open or trapping Tab there would
  // hijack a mid-thought typist. It sits in the natural Tab order and its
  // alertdialog role announces assertively without needing focus. The overlay
  // covers the screen, so there it behaves as a true modal: focus moves onto
  // the dismiss action on open, Tab / Shift+Tab cycle within the card's own
  // focusables (the two resource links and the dismiss button — a minimal
  // hand-rolled trap), and focus returns to the previously-focused element
  // (the composer, usually) on dismiss.
  useEffect(() => {
    if (!overlay) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dismissRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const target = wrapFocus(focusables, document.activeElement as HTMLElement | null, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [overlay]);

  return (
    <>
      {/* The docked variant never takes focus, and screen-reader/browser
          pairs announce a never-focused alertdialog inconsistently. This
          sr-only companion is a separate live region that always announces
          reliably when this component mounts. Overlay skips it: it steals
          focus on open (see above), so its alertdialog is reliably announced
          on its own — a second live region there would double-announce. The
          wording deliberately omits the 988/findahelpline specifics (visible
          just below in the card) so overlay users never hear them twice. */}
      {!overlay && (
        <div role="status" aria-live="assertive" className="sr-only">
          Support resources are available below this conversation.
        </div>
      )}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal={overlay || undefined}
        aria-label="Support resources"
        // Both variants clear the composer by tracking its measured height
        // (`--composer-height`, published by ChatScreen): the failure notice and
        // the textarea's autosize can grow the form well past any static offset.
        // The fallbacks are the composer's base heights (69px / 81px), keeping
        // the original resting positions (96px / 104px) before the first measure.
        className="animate-crisis-rise fixed inset-x-3 bottom-[calc(var(--composer-height,69px)+27px)] z-50 mx-auto max-w-md overflow-hidden rounded-3xl border border-[color:var(--crisis-border)] bg-[color:var(--crisis)] p-5 text-[color:var(--crisis-foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_18px_48px_-12px_var(--crisis-glow)] lg:absolute lg:inset-x-auto lg:bottom-[calc(var(--composer-height,81px)+23px)] lg:left-1/2 lg:z-20 lg:mx-0 lg:w-[min(460px,calc(100%-80px))] lg:max-w-none lg:-translate-x-1/2"
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
          ref={dismissRef}
          onClick={onDismiss}
          className="mt-4 h-11 w-full rounded-xl border border-[color:var(--crisis-border)] bg-[color:var(--crisis)] text-sm font-medium outline-none transition-[transform,background-color] duration-150 hover:bg-[color:var(--crisis-border)]/40 focus-visible:ring-2 focus-visible:ring-[color:var(--crisis-muted)]/50 active:scale-[0.98]"
        >
          I&apos;m safe right now
        </button>
      </div>
    </>
  );
}
