"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { composeSubmitTitle, isComposeSubmit } from "@/lib/keyboard";
import { relativeTime } from "@/lib/relative-time";
import type { SelfNote } from "@/lib/notes";
import { useIsMac } from "@/lib/use-is-mac";

// Mirrors MAX_NOTE_BODY_LENGTH in @/lib/notes — kept as a local literal so this
// client component never pulls the server-only notes module (and its db import)
// into the browser bundle. The server route is the real guard; this only caps
// the textarea.
const NOTE_MAX = 2000;

// The person's private kept lines — hand-written here or set aside from a
// conversation. Never shared: there is no route from this screen to a therapist,
// by design. Newest first; each line can be let go, one deliberate confirm away.
export function NotesScreen({ notes }: { notes: SelfNote[] }) {
  const router = useRouter();
  const isMac = useIsMac();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const body = draft.trim();
    if (body.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? "A gentle pace — give it a moment, then try again. Your words are still here."
            : "Couldn't save that just now — your words are still here. Try again.",
        );
        return;
      }
      setDraft("");
      router.refresh();
    } catch {
      setError("Couldn't save that just now — your words are still here. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-10 px-5 pb-20 pt-8 md:pt-14">
      <div aria-hidden className="ambient-room" />

      <div className="animate-message-rise flex flex-col gap-3">
        <Link
          href="/chat"
          className="inline-flex w-fit items-center gap-1.5 rounded-full py-1 pr-2 text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
            <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to your conversations
        </Link>
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Kept lines
        </span>
        <h1 className="text-balance font-serif text-[1.9rem] font-medium leading-[1.2] tracking-[-0.01em]">
          Notes to your future self
        </h1>
        <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
          Lines worth remembering, kept for the next hard night. Only you can ever
          read these.
        </p>
      </div>

      <section className="animate-message-rise flex flex-col gap-2" style={{ animationDelay: "40ms" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isComposeSubmit(e)) {
              e.preventDefault();
              void save();
            }
          }}
          maxLength={NOTE_MAX}
          rows={3}
          aria-label="Write a note to your future self"
          placeholder="Write something your future self should hear…"
          className="w-full resize-none rounded-2xl border bg-card/60 px-4 py-3 text-left font-serif text-[0.98rem] leading-relaxed text-foreground outline-none transition-[border-color] duration-150 placeholder:text-muted-foreground/80 focus-visible:border-accent"
        />
        <div className="flex items-center justify-end gap-3">
          {error ? (
            <p role="alert" className="mr-auto font-serif text-[12px] italic text-accent">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving || draft.trim().length === 0}
            title={composeSubmitTitle("save", isMac)}
            className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-medium text-accent-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <section className="animate-message-rise flex flex-col gap-2.5" style={{ animationDelay: "90ms" }}>
        {notes.length === 0 ? (
          <p className="text-pretty font-serif text-[0.95rem] italic leading-relaxed text-muted-foreground">
            Nothing kept yet. When a line matters — here or in a conversation — set
            it aside for the you who&apos;ll need it.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {notes.map((note) => (
              <li key={note.id}>
                <NoteCard note={note} onDeleted={() => router.refresh()} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// One kept line: its words, when it was set aside, a quiet mark when it came
// from a conversation, and a two-step "let it go" that never deletes on the
// first click. Per-card busy/error state so one note's trouble never blocks the
// rest.
function NoteCard({ note, onDeleted }: { note: SelfNote; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't let that go just now — try again.");
        return;
      }
      onDeleted();
    } catch {
      setError("Couldn't let that go just now — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card/60 p-4">
      <p className="text-pretty font-serif text-[0.98rem] leading-relaxed text-foreground">{note.body}</p>
      <div className="flex items-center gap-3">
        <time suppressHydrationWarning className="text-[11.5px] tabular-nums text-muted-foreground/80">
          {relativeTime(note.createdAt)}
        </time>
        {note.sourceMessageId ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-accent/90">
            <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden>
              <path d="M4 2.5h8v11l-4-3-4 3v-11Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Kept from a conversation
          </span>
        ) : null}
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:opacity-50"
            >
              {busy ? "Letting go…" : "Yes, let it go"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Keep it
            </button>
          </div>
          <p className="font-serif text-[12px] italic leading-relaxed text-muted-foreground">
            This removes the note for good.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-fit rounded-lg border px-3 py-1.5 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:border-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]"
        >
          Let it go
        </button>
      )}

      {error ? (
        <p role="alert" className="font-serif text-[12px] italic text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
}
