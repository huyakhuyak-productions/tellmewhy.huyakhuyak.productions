"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { focusAfterDestructive } from "@/components/ui/destructive-focus";
import { composeSubmitTitle, isComposeSubmit } from "@/lib/keyboard";
import { useIsMac } from "@/lib/use-is-mac";
import { relativeTime } from "@/lib/relative-time";
import { entryCountLabel } from "@/lib/exercise-engagement";
import type { TherapistAssignment } from "@/lib/exercises";
import type { ThoughtRecordPayload } from "@/lib/thought-record-draft";

// The therapist's homework desk: assign a thought record (the one exercise
// type), watch how the client is engaging — a count and a recency, never the
// content — and read only the entries the client chose to share. An assigned
// instruction is deliberately framed as the therapist's own words: it reaches
// the client as from a human, exactly like an intervention.

const MAX_INSTRUCTION = 2000;

export function ExercisePanel({
  clientId,
  clientName,
  assignments,
}: {
  clientId: string;
  clientName: string;
  assignments: TherapistAssignment[];
}) {
  const router = useRouter();
  const isMac = useIsMac();
  const [instruction, setInstruction] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Close is pending-then-settled, not optimistic: the button stays mounted
  // reading "Closing…" until the request resolves, so there's never a dead
  // instant where it vanished but nothing confirmed. Only a confirmed success
  // flips the card to "Closed" (the server truth then lands on refresh). A
  // failure's message belongs to the card that owns the failed close, not to a
  // panel-wide banner — each card holds and renders its own close error.
  const [closedOverride, setClosedOverride] = useState<Set<string>>(new Set());
  const [closingId, setClosingId] = useState<string | null>(null);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    const text = instruction.trim();
    if (!text || assigning) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const res = await fetch(`/api/therapist/clients/${clientId}/exercises`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "thought_record", instruction: text }),
      });
      if (res.ok) {
        setInstruction("");
        router.refresh();
        return;
      }
      setAssignError(
        res.status === 429
          ? "A gentle pace — give it a moment, then try again. Your words are still here."
          : "That didn't send. Your words are still here — try again.",
      );
    } catch {
      setAssignError("That didn't send. Your words are still here — try again.");
    } finally {
      setAssigning(false);
    }
  }

  // Resolves null on a confirmed close (so the card can hand focus off before
  // its close button unmounts) or the error copy on failure — the card renders
  // that copy in its own alert line. Failure leaves the card untouched (the
  // flip never happened, so there's nothing to revert). Callers must not invoke
  // this while another close is in flight (the card guards on `busy`): null here
  // always means a real, confirmed close — never a silently-ignored click.
  async function close(exerciseId: string): Promise<string | null> {
    setClosingId(exerciseId);
    try {
      const res = await fetch(`/api/therapist/exercises/${exerciseId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (res.ok) {
        setClosedOverride((prev) => new Set(prev).add(exerciseId));
        router.refresh();
        return null;
      }
      return res.status === 429
        ? "A gentle pace — give it a moment, then try again."
        : "Couldn't close that just now — try again.";
    } catch {
      return "Couldn't close that just now — try again.";
    } finally {
      setClosingId(null);
    }
  }

  return (
    <section aria-labelledby="exercises-heading" className="flex flex-col gap-5">
      <div>
        <h2
          id="exercises-heading"
          className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
        >
          Homework
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Assign a thought record. You&apos;ll see when {clientName} works on it — never what they write,
          unless they share it.
        </p>
      </div>

      <form
        aria-label="Assign a thought record"
        onSubmit={assign}
        className="flex flex-col gap-2.5 rounded-2xl border border-border/75 bg-card/50 px-4 py-3.5"
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent/[0.12] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-accent">
            Thought record
          </span>
        </div>
        <textarea
          aria-label="Thought record instruction"
          placeholder="What would you like them to notice? e.g. “Next time you feel that dread before work, walk it back a step at a time.”"
          value={instruction}
          maxLength={MAX_INSTRUCTION}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (isComposeSubmit(e)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={3}
          className="min-h-[4.5rem] w-full resize-y rounded-xl border bg-card px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/60 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        {/* The deliberate framing: an assignment carries the therapist's voice. */}
        <p className="text-[11.5px] italic text-muted-foreground">
          This will appear to {clientName} as from you.
        </p>
        {assignError ? (
          <p role="alert" className="font-serif text-[12.5px] italic leading-relaxed text-crisis-muted">
            {assignError}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!instruction.trim() || assigning}
            title={composeSubmitTitle("assign", isMac)}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,opacity,scale] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
          >
            {assigning ? "Assigning…" : "Assign thought record"}
          </button>
        </div>
      </form>

      {assignments.length === 0 ? (
        <p className="text-[12.5px] italic text-muted-foreground/80">
          Nothing assigned yet. What you assign here reaches {clientName} in their own space.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {assignments.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              closed={closedOverride.has(a.id) || a.status === "closed"}
              closing={closingId === a.id}
              busy={closingId !== null}
              onClose={() => close(a.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AssignmentCard({
  assignment,
  closed,
  closing,
  busy,
  onClose,
}: {
  assignment: TherapistAssignment;
  closed: boolean;
  closing: boolean;
  /** Any card's close is in flight — the panel serializes closes one at a time. */
  busy: boolean;
  /** Resolves null on a confirmed close, or the error copy on failure. */
  onClose: () => Promise<string | null>;
}) {
  const { instruction, entryCount, lastEntryAt, sharedEntryIds } = assignment;
  // A confirmed close unmounts the close button, so focus is handed to the
  // card itself first (tabIndex={-1}) — it never drops to the document body,
  // and a screen reader lands on the card now carrying its "Closed" chip.
  const cardRef = useRef<HTMLLIElement>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  async function handleClose() {
    // A click ignored because another close is already in flight is a pure
    // no-op: it must not confirm (no focus handoff) nor surface an error.
    if (busy) return;
    setCloseError(null);
    const error = await onClose();
    if (error) setCloseError(error);
    else focusAfterDestructive(cardRef);
  }
  return (
    <li
      ref={cardRef}
      tabIndex={-1}
      className="flex flex-col gap-2.5 rounded-2xl border border-border/75 bg-card/55 px-4 py-3.5 outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-accent/90">
          Thought record
        </span>
        {closed ? (
          <span className="shrink-0 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
            Closed
          </span>
        ) : null}
      </div>

      <p className="text-pretty font-serif text-[0.98rem] leading-relaxed text-foreground">
        {instruction}
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="tabular-nums">{entryCountLabel(entryCount)}</span>
        {entryCount > 0 && lastEntryAt ? (
          <>
            <span aria-hidden>·</span>
            <time
              suppressHydrationWarning
              dateTime={lastEntryAt.toISOString()}
              className="tabular-nums"
            >
              last {relativeTime(lastEntryAt)}
            </time>
          </>
        ) : null}
      </div>

      {sharedEntryIds.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Shared with you
          </span>
          <ul className="flex flex-col gap-1.5">
            {sharedEntryIds.map((entryId) => (
              <li key={entryId}>
                <SharedEntry entryId={entryId} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!closed ? (
        <div className="flex items-center justify-end gap-3">
          {closeError ? (
            <p role="alert" className="font-serif text-[11.5px] italic text-crisis-muted">
              {closeError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleClose()}
            disabled={closing}
            aria-label="Close this assignment"
            className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground outline-none transition-[color,background-color] duration-150 hover:bg-accent/10 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            {closing ? "Closing…" : "Close assignment"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

// The fields of a completed thought record, in the CBT order the client filled
// them, each rendered read-only. Optional context (when / body) shows only when
// present. This is the client's OWN words — plain text, never markdown.
const ENTRY_FIELDS: { key: keyof ThoughtRecordPayload; label: string }[] = [
  { key: "occurredAt", label: "When it happened" },
  { key: "situation", label: "The situation" },
  { key: "thoughts", label: "Their thoughts" },
  { key: "emotions", label: "What they felt" },
  { key: "behavior", label: "What they did" },
  { key: "bodySensations", label: "In their body" },
];

type FetchedEntry = { payload: ThoughtRecordPayload; createdAt: string };

// One shared entry, read lazily. Collapsed to a quiet toggle; on open it fetches
// the worksheet once and renders it read-only. A read here audits (server-side)
// into the client's trust feed, so the fetch is deferred until the therapist
// actually chooses to read — opening the assignment card never reads content.
function SharedEntry({ entryId }: { entryId: string }) {
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<FetchedEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (entry || loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/therapist/entries/${entryId}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { entry: FetchedEntry };
      setEntry(data.entry);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const bodyId = `entry-${entryId}`;
  return (
    <div className="rounded-xl border border-accent/20 bg-accent/[0.04]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground outline-none transition-colors duration-150 hover:bg-accent/[0.06] focus-visible:bg-accent/[0.07]"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-accent/90">
          <path
            d="M8 1.8 3 4v3.5c0 3 2.1 5.2 5 6.7 2.9-1.5 5-3.7 5-6.7V4L8 1.8Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="flex-1">{open ? "Hide shared record" : "Read shared record"}</span>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        id={bodyId}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-accent/15 px-3 py-3">
            {loading ? (
              <p className="text-[12px] italic text-muted-foreground motion-safe:animate-pulse">
                Opening their record…
              </p>
            ) : error ? (
              <p role="alert" className="text-[12px] italic text-crisis-muted">
                Couldn&apos;t open that record just now — try again.
              </p>
            ) : entry ? (
              <WorksheetReadOnly payload={entry.payload} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorksheetReadOnly({ payload }: { payload: ThoughtRecordPayload }) {
  return (
    <dl className="flex flex-col gap-3">
      {ENTRY_FIELDS.map((field) => {
        const value = payload[field.key];
        if (!value || !value.trim()) return null;
        return (
          <div key={field.key} className="flex flex-col gap-1">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {field.label}
            </dt>
            <dd className="text-pretty font-serif text-[0.95rem] leading-relaxed text-foreground">
              {value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
