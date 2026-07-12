"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { serializeDraft, THOUGHT_RECORD_DRAFT_KEY } from "@/lib/thought-record-draft";

// The fixed line the "walk through" affordance drops into the composer. The
// model (its homework section) takes it from there, guiding column by column.
// Private to this file — the affordance is its only consumer.
const WALK_THROUGH_LINE = "Can you walk me through a thought record?";

// Two quiet ways to bring a thought record into the conversation, sitting just
// above the composer:
//   - "Walk through a thought record" seeds the composer with the fixed line so
//     the person sends it themselves — the AI then guides the columns.
//   - "Save what we worked out" (only once there's real back-and-forth to draw
//     from) asks the extractor to draft a record from the transcript, stashes it
//     for the worksheet, and routes there PREFILLED. Extraction saves nothing —
//     the person confirms and corrects the draft on the worksheet.
export function ThoughtRecordAffordance({
  conversationId,
  canExtract,
  onSeed,
}: {
  conversationId: string;
  /** True once there's an exchange worth extracting a record from. */
  canExtract: boolean;
  /** Drop the fixed walk-through line into the composer and focus it. */
  onSeed: (text: string) => void;
}) {
  const router = useRouter();
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // seedComposer APPENDS the fixed line to whatever is in the composer, so a
  // double-click (or double-tap) would drop the line in twice. Latch on a ref
  // the moment it seeds once — the append is synchronous, so there's no pending
  // window to gate on. The latch re-arms per conversation: switching threads is
  // the one time the same walk-through line is worth offering again.
  const seededRef = useRef(false);
  useEffect(() => {
    seededRef.current = false;
  }, [conversationId]);

  function seedWalkThrough() {
    if (seededRef.current) return;
    seededRef.current = true;
    onSeed(WALK_THROUGH_LINE);
  }

  async function saveWorkedOut() {
    if (extracting) return;
    setError(null);
    setExtracting(true);
    try {
      const res = await fetch("/api/exercises/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      if (!res.ok) {
        // 502 = the extractor couldn't shape a record from this chat yet; say so
        // gently rather than blaming the person. Anything else is a generic hiccup.
        setError(
          res.status === 502
            ? "Nothing to pull out just yet — talk it through a little more, then try again."
            : "Couldn't do that just now — try again.",
        );
        return;
      }
      const payload = await res.json();
      // Hand the draft off via sessionStorage (never the URL — it's private
      // content), then open the worksheet where it prefills.
      sessionStorage.setItem(THOUGHT_RECORD_DRAFT_KEY, serializeDraft(payload));
      router.push("/exercises");
    } catch {
      setError("Couldn't do that just now — try again.");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="mx-auto mb-2 flex w-full max-w-[760px] flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <button
        type="button"
        onClick={seedWalkThrough}
        className="inline-flex items-center gap-1.5 rounded-full py-1 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 12.5V4a1 1 0 0 1 1-1h6.5M10.5 3l2.5 2.5M13 5.5V12a1 1 0 0 1-1 1H5.5M4 12l7.5-7.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Walk through a thought record
      </button>

      {canExtract ? (
        <button
          type="button"
          onClick={saveWorkedOut}
          disabled={extracting}
          className="inline-flex items-center gap-1.5 rounded-full py-1 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
        >
          {extracting ? "Drafting…" : "Save what we worked out"}
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="w-full font-serif text-[12px] italic text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
}
