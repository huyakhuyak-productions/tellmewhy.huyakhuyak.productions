"use client";

import { useEffect, useRef, useState } from "react";

// The quiet "copy this" gesture — lift a line out of the conversation to carry
// elsewhere. Entirely private and instant: copying touches nothing server-side.
// Mirrors the Keep affordance's hover-revealed idiom so the reading column
// stays calm, and mounts on the person's own words and the AI's alike.
export function MessageCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending "Copied → Copy" revert if the row unmounts mid-flash
  // (a version switch or refresh can replace this message before 1.5s is up).
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // A missing clipboard (insecure context, denied permission) is not the
      // person's fault — a calm line, never an alarm.
      setError("Couldn't copy just now — try again.");
    }
  }

  return (
    <>
      {/* One always-mounted live region so the confirmation is spoken even
          though the label only flips for 1.5s — a freshly inserted region's
          content usually goes unannounced (same idiom as MessageKeep). */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
      <div className="mt-1 flex items-center gap-2 pr-1">
        {error ? (
          <span role="alert" className="font-serif text-[11px] italic text-accent">
            {error}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={copied ? "Copied to clipboard" : "Copy this message"}
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground/70 opacity-0 outline-none transition-[opacity,color] duration-150 hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/msg:opacity-100 active:scale-[0.96]"
        >
          <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden>
            {copied ? (
              <path
                d="M3.5 8.5 6.5 11.5 12.5 5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <>
                <rect x="5" y="5" width="8" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M3 11V3.6A1.6 1.6 0 0 1 4.6 2H10"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            )}
          </svg>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </>
  );
}
