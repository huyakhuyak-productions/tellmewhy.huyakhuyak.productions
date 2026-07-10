"use client";

import { useEffect, useRef, useState } from "react";
import {
  draftToPayload,
  missingRequiredFields,
  type RequiredField,
  type ThoughtRecordDraft,
} from "@/lib/thought-record-draft";
import { SharePrompt } from "./share-prompt";

export type WorksheetExercise = { id: string; instruction: string; therapistName: string | null };

// Each column of the record as a reflective prompt rather than a form label —
// the placeholders the brief pins are kept verbatim. The vertical order IS the
// CBT chain (situation → thoughts → emotions → behavior), so no numbering is
// needed to carry the sequence; optional context brackets it (when / body).
type Field = {
  key: keyof ThoughtRecordDraft;
  label: string;
  placeholder: string;
  optional?: boolean;
  /** occurredAt is a short one-line "when"; the rest are multi-line reflections. */
  multiline: boolean;
};

const FIELDS: Field[] = [
  {
    key: "occurredAt",
    label: "When it happened",
    placeholder: "e.g. last night, or after the meeting",
    optional: true,
    multiline: false,
  },
  {
    key: "situation",
    label: "The situation",
    placeholder: "What set it off — where you were, who was there.",
    multiline: true,
  },
  {
    key: "thoughts",
    label: "Your thoughts",
    placeholder: 'What went through your mind? e.g. "They probably think I\'m an idiot"',
    multiline: true,
  },
  {
    key: "emotions",
    label: "What you felt",
    placeholder: "e.g. anxiety, anger, shame, disgust",
    multiline: true,
  },
  {
    key: "behavior",
    label: "What you did",
    placeholder: "What did you do? e.g. avoided the situation",
    multiline: true,
  },
  {
    key: "bodySensations",
    label: "In your body",
    placeholder: "Any physical sensations — a tight chest, a racing heart.",
    optional: true,
    multiline: true,
  },
];

const MISSING_LABEL: Record<RequiredField, string> = {
  situation: "the situation",
  thoughts: "your thoughts",
  emotions: "what you felt",
  behavior: "what you did",
};

function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// The thought record as a calm, single-column journal page. Saves via
// POST /api/entries; when the saved entry is anchored to an assignment AND a
// live link exists, the one share prompt follows — otherwise the save simply
// completes (self-guided and prefilled-from-chat entries never see the prompt).
export function WorksheetForm({
  exercise,
  activeLink,
  initialDraft,
  prefilled,
  onCancel,
  onSaved,
}: {
  /** The assignment this record answers, or null for a self-guided record. */
  exercise: WorksheetExercise | null;
  /** The live trusted-person link, if any — gates the post-save share prompt. */
  activeLink: { therapistName: string } | null;
  /** Prefill (from chat extraction), or empty for a fresh record. */
  initialDraft: ThoughtRecordDraft;
  /** True when initialDraft came from an AI extraction — shown honestly. */
  prefilled: boolean;
  onCancel: () => void;
  /** Called once the record is saved AND any share choice is resolved. */
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ThoughtRecordDraft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the save succeeds for an assigned entry under a live link — swaps
  // the form for the single share prompt.
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRefs = useRef<Partial<Record<keyof ThoughtRecordDraft, HTMLTextAreaElement | HTMLInputElement>>>({});

  // Size prefilled textareas to their content on mount (programmatic value sets
  // bypass the onChange autosize). Cheap and one-shot.
  useEffect(() => {
    for (const el of Object.values(fieldRefs.current)) {
      if (el instanceof HTMLTextAreaElement) grow(el);
    }
  }, []);

  function set(key: keyof ThoughtRecordDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (saving) return;
    const missing = missingRequiredFields(draft);
    if (missing.length > 0) {
      const first = missing[0];
      setError(`Add a few words to ${MISSING_LABEL[first]} before saving.`);
      fieldRefs.current[first]?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(exercise ? { exerciseId: exercise.id } : {}),
          payload: draftToPayload(draft),
        }),
      });
      if (!res.ok) {
        setError("Couldn't save that just now — your words are still here. Try again.");
        return;
      }
      const body: { id?: string } | null = await res.json().catch(() => null);
      // The share prompt only appears for an assigned entry under a live link;
      // everything else (self-guided, prefilled-from-chat, or no link) is done.
      if (exercise && activeLink && body?.id) {
        setSavedEntryId(body.id);
        return;
      }
      onSaved();
    } catch {
      setError("Couldn't save that just now — your words are still here. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (savedEntryId && activeLink) {
    return (
      <SharePrompt entryId={savedEntryId} therapistName={activeLink.therapistName} onResolved={onSaved} />
    );
  }

  return (
    <form
      ref={formRef}
      aria-label="Thought record"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-8"
    >
      <header className="animate-message-rise flex flex-col gap-2">
        {exercise ? (
          <>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-accent/90">
              {exercise.therapistName ? `From ${exercise.therapistName}` : "From your therapist"}
            </span>
            <p className="text-pretty font-serif text-[1.15rem] italic leading-relaxed text-foreground">
              {exercise.instruction}
            </p>
          </>
        ) : (
          <>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              A thought record
            </span>
            <p className="text-pretty font-serif text-[1.15rem] italic leading-relaxed text-muted-foreground">
              {prefilled
                ? "Drawn from your conversation. Read it back and make it yours — nothing saves until you say so."
                : "Walk back through one moment, a piece at a time. There are no wrong answers here."}
            </p>
          </>
        )}
      </header>

      <div className="flex flex-col gap-7">
        {FIELDS.map((field, index) => {
          const id = `tr-${field.key}`;
          const value = draft[field.key];
          return (
            <div
              key={field.key}
              className="animate-message-rise flex flex-col gap-2"
              style={{ animationDelay: `${60 + index * 55}ms` }}
            >
              <label htmlFor={id} className="flex items-baseline gap-2 font-serif text-[1.02rem] text-foreground">
                {field.label}
                {field.optional ? (
                  <span className="text-[11px] font-sans not-italic tracking-wide text-muted-foreground/80">
                    optional
                  </span>
                ) : null}
              </label>
              {field.multiline ? (
                <textarea
                  id={id}
                  ref={(el) => {
                    if (el) fieldRefs.current[field.key] = el;
                  }}
                  value={value}
                  onChange={(e) => {
                    set(field.key, e.target.value);
                    grow(e.target);
                  }}
                  rows={2}
                  maxLength={2000}
                  placeholder={field.placeholder}
                  className="w-full resize-none rounded-xl border bg-card/60 px-3.5 py-3 font-serif text-[0.98rem] leading-relaxed text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:italic placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                />
              ) : (
                <input
                  id={id}
                  ref={(el) => {
                    if (el) fieldRefs.current[field.key] = el;
                  }}
                  value={value}
                  onChange={(e) => set(field.key, e.target.value)}
                  maxLength={100}
                  placeholder={field.placeholder}
                  className="w-full rounded-xl border bg-card/60 px-3.5 py-2.5 font-serif text-[0.98rem] text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:italic placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                />
              )}
            </div>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="font-serif text-[13px] italic text-accent">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-accent px-5 py-2.5 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save this record"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl px-4 py-2.5 text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
