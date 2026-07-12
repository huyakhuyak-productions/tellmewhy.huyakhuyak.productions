"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { composeSubmitTitle, isComposeSubmit } from "@/lib/keyboard";
import { useIsMac } from "@/lib/use-is-mac";

// 1 (low) → 5 (good), matching the domain's scale. Gentle, non-clinical words
// tuned to the twilight room — a heavy night through to a bright one — never a
// verdict on the person.
const MOODS = [
  { score: 1, label: "Heavy" },
  { score: 2, label: "Low" },
  { score: 3, label: "Okay" },
  { score: 4, label: "Good" },
  { score: 5, label: "Bright" },
] as const;

const NOTE_MAX = 500;

// The one-tap check-in near the hero. Each mood is a point of light that
// brightens across the scale; the chosen one lifts to the accent and gains a
// soft halo — the same dot the trend sparkline is drawn from. A quiet, optional
// "add a word" disclosure is offered, never demanded. Same-day taps upsert, so
// today's value stays selected and can be changed at will.
export function MoodCheckin({
  initialScore,
  initialNote,
}: {
  initialScore: number | null;
  initialNote: string | null;
}) {
  const router = useRouter();
  const isMac = useIsMac();
  const [score, setScore] = useState<number | null>(initialScore);
  // The note lives in two layers: what the server already holds (savedNote) and
  // what's being typed (draft). A glyph re-tap posts only {score} — no note key
  // — and the server's upsert PRESERVES the day's existing note untouched; the
  // client never re-sends it. Only "Save a word" posts the note field, which
  // sets it (non-empty draft) or clears it (""). A glyph tap must never quietly
  // commit half-typed words.
  const [savedNote, setSavedNote] = useState(initialNote ?? "");
  const [draft, setDraft] = useState(initialNote ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The "Saved" flash timer. Held in a ref so it survives re-renders, is
  // cleared before re-arming (rapid saves), and is cancelled on unmount — a
  // stray setNoteSaved(false) after unmount would warn and leak the timer.
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const checkedIn = score !== null;
  const selectedLabel = MOODS.find((m) => m.score === score)?.label ?? null;

  async function post(body: { score: number; note?: string }): Promise<boolean> {
    try {
      const res = await fetch("/api/mood", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function choose(next: number) {
    if (saving) return;
    const previous = score;
    setError(null);
    setScore(next); // optimistic
    setSaving(true);
    // A tap is a pure score signal — it carries no note key at all. The
    // server's upsert preserves whatever note the day already holds, so the
    // saved note survives without the client re-sending it.
    const ok = await post({ score: next });
    setSaving(false);
    if (!ok) {
      setScore(previous); // revert
      setError("Couldn't save that just now — try again.");
      return;
    }
    router.refresh();
  }

  async function saveNote() {
    if (score === null || saving) return;
    setError(null);
    setSaving(true);
    // The deliberate note gesture always sends the field: a non-empty draft
    // stores it, an empty one clears the day's note (the server reads "" as an
    // explicit delete, distinct from a note-less tap).
    const ok = await post({ score, note: draft.trim() });
    setSaving(false);
    if (!ok) {
      setError("Couldn't save that just now — try again.");
      return;
    }
    setSavedNote(draft); // the draft is now what the server holds
    setNoteSaved(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setNoteSaved(false), 1800);
    router.refresh();
  }

  return (
    <section className="flex w-full max-w-[420px] flex-col items-center gap-3 text-center">
      <p className="font-serif text-[13px] italic text-muted-foreground">How are you tonight?</p>

      <div role="group" aria-label="How are you tonight?" className="flex items-center justify-center gap-1.5">
        {MOODS.map((m) => {
          const selected = score === m.score;
          return (
            <button
              key={m.score}
              type="button"
              aria-pressed={selected}
              aria-label={`${m.label} — ${m.score} of 5`}
              title={m.label}
              onClick={() => choose(m.score)}
              disabled={saving}
              className="flex size-11 items-center justify-center rounded-full outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.96] disabled:cursor-default"
            >
              <span
                aria-hidden
                className="size-[13px] rounded-full transition-[background-color,box-shadow,opacity] duration-200"
                style={{
                  backgroundColor: selected ? "var(--accent)" : "var(--muted-foreground)",
                  // Brighten across the scale so the row itself reads low → good.
                  opacity: selected ? 1 : 0.22 + (m.score - 1) * 0.15,
                  boxShadow: selected ? "0 0 0 3px var(--glow)" : undefined,
                }}
              />
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="min-h-[1.1rem] text-[12px]">
        {checkedIn ? (
          <p className="text-muted-foreground">
            <span className="text-foreground">{selectedLabel}.</span> Checked in — change it any time.
          </p>
        ) : (
          <p className="text-muted-foreground">One tap. Just for you.</p>
        )}
      </div>

      {checkedIn ? (
        noteOpen ? (
          <div className="animate-message-rise flex w-full flex-col items-stretch gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (isComposeSubmit(e)) {
                  e.preventDefault();
                  void saveNote();
                }
              }}
              maxLength={NOTE_MAX}
              rows={2}
              aria-label="A word about how you feel"
              placeholder="A word about it, if you want one."
              className="w-full resize-none rounded-xl border bg-card/60 px-3 py-2 text-left font-serif text-[13px] italic text-foreground outline-none transition-[border-color] duration-150 placeholder:text-muted-foreground/80 focus-visible:border-accent"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setNoteOpen(false)}
                className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Done
              </button>
              <button
                type="button"
                onClick={saveNote}
                disabled={saving}
                title={composeSubmitTitle("save", isMac)}
                className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.96] disabled:opacity-50"
              >
                {saving ? "Saving…" : noteSaved ? "Saved" : "Save a word"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="rounded-full px-2 py-1 text-[12px] text-accent outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {savedNote.trim() ? "Edit your note" : "add a word about it"}
          </button>
        )
      ) : null}

      {error ? (
        <p role="alert" className="font-serif text-[12px] italic text-accent">
          {error}
        </p>
      ) : null}
    </section>
  );
}
