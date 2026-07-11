"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EMPTY_DRAFT,
  parseDraft,
  THOUGHT_RECORD_DRAFT_KEY,
  type ThoughtRecordDraft,
} from "@/lib/thought-record-draft";
import { relativeTime } from "@/lib/relative-time";
import { EntryList, type PastEntry } from "./entry-list";
import { WorksheetForm, type WorksheetExercise } from "./worksheet-form";

export type Assignment = { id: string; instruction: string; therapistName: string | null; createdAt: Date };

// An assignment whose therapist link has since been revoked: kept as the
// person's own data but no longer an open ask, so it carries no therapist name
// and never opens a worksheet.
export type PastAssignment = { id: string; instruction: string; createdAt: Date };

// One open worksheet: which assignment it answers (null = self-guided), and what
// it opened prefilled with (empty for a fresh record). `prefilled` drives the
// honest "drawn from your conversation" note.
type Worksheet = { exercise: WorksheetExercise | null; initialDraft: ThoughtRecordDraft; prefilled: boolean };

export function ExercisesScreen({
  assignments,
  pastAssignments = [],
  entries,
  activeLink,
  startExerciseId,
}: {
  /** Active assignments from the trusted person — the actionable homework. */
  assignments: Assignment[];
  /** Assignments from an ended connection — quiet history, never actionable. */
  pastAssignments?: PastAssignment[];
  /** Every record the person has written, most recent first. */
  entries: PastEntry[];
  /** The live link, if any — gates the post-save share prompt. */
  activeLink: { therapistName: string } | null;
  /** An assignment id to open straight into (from a home card), or null. */
  startExerciseId: string | null;
}) {
  const router = useRouter();
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  // The list ↔ worksheet hand-offs (draft from chat, start-from-home) must run
  // exactly once on mount, never re-fire when props change under a refresh.
  const opened = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The list ↔ worksheet swap unmounts whatever was focused (the clicked card,
  // the form's buttons), which would drop focus to <body> and leave a screen
  // reader silent about the change. The page heading is shared by both views
  // and re-reads with the new view's title, so landing focus there both anchors
  // the keyboard user and announces the swap — the same calm move-not-trap
  // pattern SharePrompt uses. rAF so the focus lands after React commits.
  function focusHeading() {
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  // A one-shot, mount-only hand-off: reads client-only sessionStorage and the
  // start-id prop exactly once (the ref latches, guarding against re-runs under
  // router.refresh) and opens the corresponding worksheet. This is a deliberate
  // post-hydration state sync from an external system (sessionStorage can't be a
  // lazy useState initializer without a hydration mismatch), not a
  // cascading-render bug — it can never loop.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;

    // A chat "save what we worked out" hand-off wins: it's a self-guided draft
    // the person asked to turn into a record. Consume the key so a refresh or a
    // later visit never re-opens it.
    let initial: Worksheet | null = null;
    const stashed = sessionStorage.getItem(THOUGHT_RECORD_DRAFT_KEY);
    if (stashed) {
      sessionStorage.removeItem(THOUGHT_RECORD_DRAFT_KEY);
      const draft = parseDraft(stashed);
      if (draft) initial = { exercise: null, initialDraft: draft, prefilled: true };
    }

    // Otherwise, a home assignment card may have asked to open a specific
    // assignment's worksheet.
    if (!initial && startExerciseId) {
      const target = assignments.find((a) => a.id === startExerciseId);
      if (target) {
        initial = {
          exercise: { id: target.id, instruction: target.instruction, therapistName: target.therapistName },
          initialDraft: EMPTY_DRAFT,
          prefilled: false,
        };
      }
    }

    if (initial) setWorksheet(initial);
  }, [assignments, startExerciseId]);

  function openAssignment(a: Assignment) {
    setWorksheet({
      exercise: { id: a.id, instruction: a.instruction, therapistName: a.therapistName },
      initialDraft: EMPTY_DRAFT,
      prefilled: false,
    });
    focusHeading();
  }

  function openSelfGuided() {
    setWorksheet({ exercise: null, initialDraft: EMPTY_DRAFT, prefilled: false });
    focusHeading();
  }

  function closeWorksheet() {
    setWorksheet(null);
    focusHeading();
  }

  function afterSaved() {
    setWorksheet(null);
    focusHeading();
    // The saved entry lives on the server; re-fetch so it appears in the list.
    router.refresh();
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
          Thought records
        </span>
        {/* tabIndex={-1}: a programmatic focus target only (see focusHeading) —
            never in the tab order, and no ring for a landing the person didn't
            steer to by keyboard. */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-balance font-serif text-[1.9rem] font-medium leading-[1.2] tracking-[-0.01em] outline-none"
        >
          {worksheet ? "One moment, one record" : "Untangle a difficult moment"}
        </h1>
        {!worksheet ? (
          <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
            A thought record walks back through a hard moment — what happened, what
            you thought, what you felt, what you did. It&apos;s yours; you choose if
            anyone else ever sees it.
          </p>
        ) : null}
      </div>

      {worksheet ? (
        <WorksheetForm
          exercise={worksheet.exercise}
          activeLink={activeLink}
          initialDraft={worksheet.initialDraft}
          prefilled={worksheet.prefilled}
          onCancel={closeWorksheet}
          onSaved={afterSaved}
        />
      ) : (
        <>
          {/* The standalone law: /exercises always offers a fresh record, with
              no assignment and no therapist attached. */}
          <section className="animate-message-rise flex flex-col gap-3" style={{ animationDelay: "40ms" }}>
            <button
              type="button"
              onClick={openSelfGuided}
              className="flex items-center justify-between gap-3 rounded-2xl border bg-card/60 px-5 py-4 text-left outline-none transition-[border-color,transform] duration-150 hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[0.98rem] font-medium text-foreground">Start a thought record</span>
                <span className="text-[12.5px] text-muted-foreground">On your own, whenever something&apos;s weighing on you.</span>
              </span>
              <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0 text-accent" aria-hidden>
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </section>

          {assignments.length > 0 ? (
            <section className="animate-message-rise flex flex-col gap-3" style={{ animationDelay: "90ms" }}>
              <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                From your therapist
              </h2>
              <ul className="flex flex-col gap-2.5">
                {assignments.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => openAssignment(a)}
                      aria-label={`Open assignment: ${a.instruction}`}
                      className="flex w-full flex-col gap-1.5 rounded-2xl border bg-card/60 p-4 text-left outline-none transition-[border-color,transform] duration-150 hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-accent/90">
                          {a.therapistName ? `From ${a.therapistName}` : "From your therapist"}
                        </span>
                        <time
                          suppressHydrationWarning
                          className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground/80"
                        >
                          {relativeTime(a.createdAt)}
                        </time>
                      </span>
                      <span className="text-pretty font-serif text-[1.02rem] italic leading-relaxed text-foreground">
                        {a.instruction}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {pastAssignments.length > 0 ? (
            <section className="animate-message-rise flex flex-col gap-3" style={{ animationDelay: "140ms" }}>
              <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                From an ended connection
              </h2>
              {/* Inert by design: the link that carried these is gone, so they
                  are read-only history, never an open ask. No button, no name. */}
              <ul className="flex flex-col gap-2.5">
                {pastAssignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col gap-1.5 rounded-2xl border border-dashed bg-card/30 p-4 opacity-70"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                        No longer active
                      </span>
                      <time
                        suppressHydrationWarning
                        className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground/60"
                      >
                        {relativeTime(a.createdAt)}
                      </time>
                    </span>
                    <span className="text-pretty font-serif text-[1.02rem] italic leading-relaxed text-muted-foreground">
                      {a.instruction}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="animate-message-rise flex flex-col gap-3" style={{ animationDelay: "190ms" }}>
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Your records
            </h2>
            <EntryList entries={entries} />
          </section>
        </>
      )}
    </main>
  );
}
