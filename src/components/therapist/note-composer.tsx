"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { composeSubmitTitle, isComposeSubmit } from "@/lib/keyboard";
import { useIsMac } from "@/lib/use-is-mac";
import type { NoteKind } from "@/lib/therapist-notes";

const MAX_BODY = 4000;

type Copy = { label: string; placeholder: string; button: string; busy: string };

function copyFor(kind: NoteKind, clientName: string): Copy {
  if (kind === "private") {
    return {
      label: "Write a private note",
      placeholder: "For your eyes only — a thought to keep between sessions.",
      button: "Save private note",
      busy: "Saving…",
    };
  }
  if (kind === "public") {
    return {
      label: `Write a note to ${clientName}`,
      placeholder: `Something you want ${clientName} to read.`,
      button: `Publish to ${clientName}`,
      busy: "Publishing…",
    };
  }
  return {
    label: "Write AI guidance",
    placeholder: "How the AI should hold this person in their shared conversations.",
    button: "Save AI guidance",
    busy: "Saving…",
  };
}

// One create form for all three note kinds. Client-scoped (no conversationId):
// it posts to the same endpoint the API layer already gates and rate-limits.
// A 429 is met with calm copy, never a red error; the words stay in the box so
// nothing is lost.
export function NoteComposer({
  clientId,
  clientName,
  kind,
}: {
  clientId: string;
  clientName: string;
  kind: NoteKind;
}) {
  const router = useRouter();
  const isMac = useIsMac();
  const copy = copyFor(kind, clientName);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/therapist/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, kind, body: text }),
      });
      if (res.ok) {
        setBody("");
        router.refresh();
        return;
      }
      setError(
        res.status === 429
          ? "A gentle pace — give it a moment, then try again. Your words are safe here."
          : "That didn't save. Your words are still here — try again.",
      );
    } catch {
      setError("That didn't save. Your words are still here — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="font-serif text-[12.5px] italic leading-relaxed text-crisis-muted">
          {error}
        </p>
      ) : null}
      <textarea
        aria-label={copy.label}
        placeholder={copy.placeholder}
        value={body}
        maxLength={MAX_BODY}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (isComposeSubmit(e)) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        rows={3}
        className="min-h-[4.5rem] w-full resize-y rounded-xl border bg-card px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
      />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!body.trim() || busy}
          title={composeSubmitTitle("save", isMac)}
          className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,opacity,scale] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
        >
          {busy ? copy.busy : copy.button}
        </button>
      </div>
    </form>
  );
}
