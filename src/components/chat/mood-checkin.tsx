"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const [score, setScore] = useState<number | null>(initialScore);
  const [note, setNote] = useState(initialNote ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkedIn = score !== null;
  const selectedLabel = MOODS.find((m) => m.score === score)?.label ?? null;

  async function post(nextScore: number, nextNote: string): Promise<boolean> {
    const trimmed = nextNote.trim();
    const body: { score: number; note?: string } = { score: nextScore };
    if (trimmed) body.note = trimmed;
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
    const ok = await post(next, note);
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
    const ok = await post(score, note);
    setSaving(false);
    if (!ok) {
      setError("Couldn't save that just now — try again.");
      return;
    }
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1800);
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
              value={note}
              onChange={(e) => setNote(e.target.value)}
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
            {note.trim() ? "Edit your note" : "add a word about it"}
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
