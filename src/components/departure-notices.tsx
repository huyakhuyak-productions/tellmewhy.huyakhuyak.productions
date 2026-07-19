"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Departure } from "@/lib/therapist-links";
import { relativeTime } from "@/lib/relative-time";

export type DepartureSide = "therapist" | "client";

// The farewell is a plain fact, said gently. A departed partner has a name only
// while their snapshot decrypts under the survivor's key; a nameless card is
// the honest degradation, never an error.
function farewell(side: DepartureSide, name: string | null): string {
  if (side === "therapist") {
    return name ? `${name} deleted their account.` : "A client you were linked with deleted their account.";
  }
  return name ? `${name}, your trusted person, deleted their account.` : "Your trusted person deleted their account.";
}

// A quiet notice, not an alert: when a linked account departs, its card is a
// dashed-edge farewell (the same liminal card language the empty states speak
// in), a soft "when", and a single "Okay" that acknowledges it away. No badge,
// no accent fill — nothing here is asking to be celebrated or feared.
export function DepartureNotices({
  departures,
  side,
}: {
  departures: Departure[];
  side: DepartureSide;
}) {
  const router = useRouter();
  const regionRef = useRef<HTMLDivElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const hasDepartures = departures.length > 0;

  // When a farewell is present, land focus on the neutral region — not the
  // "Okay" button — so a keyboard user is oriented to it without acknowledging
  // it by reflex, and role="status" carries it to a screen reader. preventScroll
  // keeps a busy roster from lurching to the card on every visit. Keyed on
  // presence (not mount) so a late-arriving departure is focused too; pages
  // with nothing to say never steal focus onto the empty container.
  useEffect(() => {
    if (hasDepartures) regionRef.current?.focus({ preventScroll: true });
  }, [hasDepartures]);

  async function acknowledge(linkId: string) {
    if (busyId) return;
    setErrorId(null);
    setBusyId(linkId);
    try {
      const res = await fetch(`/api/links/${linkId}/acknowledge-departure`, { method: "POST" });
      if (!res.ok) {
        setErrorId(linkId);
        return;
      }
      // Anchor focus on the persistent neutral region before the acknowledged
      // card unmounts on refresh. The region div always renders (only its cards
      // are conditional), so even acknowledging the SOLE departure keeps focus
      // here instead of dropping to the document body.
      regionRef.current?.focus({ preventScroll: true });
      router.refresh();
    } catch {
      setErrorId(linkId);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div ref={regionRef} role="status" tabIndex={-1} className="flex flex-col gap-3 outline-none">
      {departures.map((d, i) => (
        <div
          key={d.linkId}
          className="animate-message-rise rounded-2xl border border-dashed border-border/70 px-5 py-5"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-pretty font-serif text-[1.05rem] leading-relaxed text-foreground">
                {farewell(side, d.name)}
              </p>
              <time
                suppressHydrationWarning
                className="mt-1 block text-[12px] tabular-nums text-muted-foreground"
              >
                {relativeTime(d.departedAt)}
              </time>
            </div>
            <button
              type="button"
              onClick={() => acknowledge(d.linkId)}
              disabled={busyId === d.linkId}
              className="shrink-0 rounded-lg border px-3.5 py-2 text-[12.5px] text-muted-foreground outline-none transition-[color,border-color,transform] duration-150 hover:border-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50"
            >
              {busyId === d.linkId ? "…" : "Okay"}
            </button>
          </div>
          {errorId === d.linkId ? (
            <p role="alert" className="mt-3 font-serif text-[12.5px] italic text-accent">
              Couldn&apos;t do that just now — try again.
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
