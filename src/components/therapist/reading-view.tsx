"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageBubble } from "@/components/chat/message-bubble";
import { composeSubmitTitle, isComposeSubmit } from "@/lib/keyboard";
import { useIsMac } from "@/lib/use-is-mac";
import {
  deepestDescendant,
  projectMarkerOntoPath,
  resolveActivePath,
  versionInfo,
} from "@/lib/message-tree";
import type { ReadingMessage } from "@/lib/therapist-desk";
import { AttentionBadge } from "./attention-badge";
import { CrisisNavigator } from "./crisis-navigator";
import { DigestPanel } from "./digest-panel";
import { ReadingVersionSwitcher } from "./reading-version-switcher";

// The therapist reads a client's shared conversation. Read-only — the same
// bubbles/passages the client sees — with two deliberate acts layered on: a
// quiet "mark read to here" on every message, and an intervention composer
// that is unmistakably framed as the therapist speaking AS themselves, never
// as the AI.
export function ReadingView({
  conversationId,
  clientId,
  messages,
  activeLeafId,
  markerMessageId,
  focusMessageId = null,
}: {
  conversationId: string;
  clientId: string;
  /** The WHOLE tree, flat (createdAt, id) asc — every branch, not just one
      path. The view resolves which path it shows from `viewLeafId` below. */
  messages: ReadingMessage[];
  /** The client's own active leaf — the branch THEY currently see. It seeds the
      therapist's initial view and anchors the digest's coverage math, but the
      therapist's local navigation never writes it back. */
  activeLeafId: string | null;
  markerMessageId: string | null;
  /** From `?focus=` on the attention queue: a message to navigate-and-land on
      at mount, on whichever branch it lives. */
  focusMessageId?: string | null;
}) {
  const router = useRouter();
  const isMac = useIsMac();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // View-local branch selection. Seeded from the client's active leaf, moved
  // ONLY by the version arrows and by landing on an off-path target — never
  // pushed back to the server, so the client's leaf is untouched.
  const [viewLeafId, setViewLeafId] = useState<string | null>(activeLeafId);

  // Constant-time lookup from id → message, over the whole tree.
  const messagesById = useMemo(
    () => new Map(messages.map((m) => [m.id, m] as const)),
    [messages],
  );

  // The single root-to-leaf path the therapist is currently reading, and the
  // messages along it in render order (root-first, matching the flat asc tree).
  const displayedPathIds = useMemo(
    () => resolveActivePath(messages, viewLeafId),
    [messages, viewLeafId],
  );
  const displayedPathIdSet = useMemo(() => new Set(displayedPathIds), [displayedPathIds]);
  const displayedMessages = useMemo(
    () =>
      displayedPathIds
        .map((id) => messagesById.get(id))
        .filter((m): m is ReadingMessage => m !== undefined),
    [displayedPathIds, messagesById],
  );

  // Version sets for the displayed path only (entries exist where count > 1).
  const versions = useMemo(
    () => versionInfo(messages, displayedPathIds),
    [messages, displayedPathIds],
  );

  // The review divider follows the marker PROJECTED onto the displayed path:
  // the marker may sit on a branch the therapist isn't viewing, so we render
  // the line after the deepest displayed message created at or before it.
  const projectedMarkerId = useMemo(
    () => projectMarkerOntoPath(messages, displayedPathIds, markerMessageId),
    [messages, displayedPathIds, markerMessageId],
  );

  // Digest coverage math intentionally rides the CLIENT's active path, not the
  // therapist's `viewLeafId`. The digest is computed server-side over the
  // client's active path, and the "N newer" coverage line counts against these
  // ids — so keeping them the client's path keeps coverage truthful no matter
  // which branch the therapist happens to be reading.
  const clientPathIds = useMemo(
    () => resolveActivePath(messages, activeLeafId),
    [messages, activeLeafId],
  );

  // The crisis navigator reaches crisis messages on ANY branch of the whole
  // tree — not just the displayed path — because landing may itself switch
  // branches. The pill's readout ("N crisis messages" / "i/N") still reads
  // sensibly: it's a count of crisis messages in the conversation, unchanged.
  const crisisIds = useMemo(
    () => messages.filter((m) => m.riskLevel === "crisis").map((m) => m.id),
    [messages],
  );

  // One ref map over ALL messages (not just crisis ones), so both the crisis
  // navigator and the digest's anchor links can land on any message by id.
  const messageRefs = useRef(new Map<string, HTMLElement>());
  const registerMessage = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) messageRefs.current.set(id, el);
      else messageRefs.current.delete(id);
    },
    [],
  );
  const [activeCrisis, setActiveCrisis] = useState(0);
  const [landed, setLanded] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // The shared landing: scroll a message to center and give it a gentle amber
  // flash — the crisis-navigator mechanic, reused verbatim for digest anchors.
  const landOn = useCallback((id: string) => {
    const el = messageRefs.current.get(id);
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    setFlashId(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1500);
  }, []);

  // Land on a message that may live OFF the displayed path. If it's already on
  // the path, scroll straight to it. Otherwise switch the view to the branch
  // that carries it (its deepest-latest continuation) and remember to land once
  // that path has re-rendered and re-registered its refs.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const focusMessage = useCallback(
    (id: string) => {
      if (!messagesById.has(id)) return;
      if (displayedPathIdSet.has(id)) {
        landOn(id);
        return;
      }
      setViewLeafId(deepestDescendant(messages, id));
      setPendingFocusId(id);
    },
    [messagesById, displayedPathIdSet, messages, landOn],
  );

  // After a branch switch re-renders the path (and the ref for the target is
  // registered), land on the pending target and clear it. Keyed on the new
  // viewLeafId so it fires only once the path has actually moved; the land runs
  // in an rAF so the freshly rendered layout is settled before we scroll.
  useEffect(() => {
    if (pendingFocusId === null) return;
    const raf = requestAnimationFrame(() => {
      landOn(pendingFocusId);
      setPendingFocusId(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingFocusId, viewLeafId, landOn]);

  // `?focus=` from the attention queue: navigate-and-land exactly once at mount.
  // The rAF defers the (possibly branch-switching) focus until after the first
  // paint, so the initial refs are registered before we try to land.
  const focusedOnMount = useRef(false);
  useEffect(() => {
    if (focusedOnMount.current || !focusMessageId) return;
    focusedOnMount.current = true;
    requestAnimationFrame(() => focusMessage(focusMessageId));
  }, [focusMessageId, focusMessage]);

  const jumpToCrisis = useCallback(
    (next: number) => {
      const id = crisisIds[next];
      if (!id) return;
      setActiveCrisis(next);
      setLanded(true);
      // A crisis message may sit on another branch — focusMessage switches to
      // it before landing, so the navigator reaches every crisis in the tree.
      focusMessage(id);
    },
    [crisisIds, focusMessage],
  );

  // Step to a sibling version, VIEW-LOCALLY: point the local view at that
  // branch's deepest-latest continuation. No network, no client-leaf mutation.
  const goToSibling = useCallback(
    (siblings: string[], targetIndex: number) => {
      const siblingId = siblings[targetIndex];
      if (!siblingId) return;
      setViewLeafId(deepestDescendant(messages, siblingId));
    },
    [messages],
  );

  async function markReadTo(messageId: string) {
    if (markingId) return;
    setMarkingId(messageId);
    setMarkError(null);
    try {
      const res = await fetch(`/api/therapist/conversations/${conversationId}/review-marker`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      setMarkError("Couldn't move your review line — try again.");
    } catch {
      setMarkError("Couldn't move your review line — try again.");
    } finally {
      setMarkingId(null);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/therapist/conversations/${conversationId}/intervention`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setBody("");
        router.refresh();
        return;
      }
      setSendError(
        res.status === 429
          ? "A gentle pace — give it a moment, then try again. Your words are safe here."
          : "That didn't send. Your words are still here — try again.",
      );
    } catch {
      setSendError("That didn't send. Your words are still here — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col">
      {messages.length > 0 ? (
        <DigestPanel
          conversationId={conversationId}
          orderedMessageIds={clientPathIds}
          onJumpToMessage={focusMessage}
        />
      ) : null}
      {crisisIds.length > 0 ? (
        <CrisisNavigator
          index={activeCrisis}
          total={crisisIds.length}
          landed={landed}
          onPrev={() => jumpToCrisis(landed ? activeCrisis - 1 : 0)}
          onNext={() => jumpToCrisis(landed ? activeCrisis + 1 : 0)}
        />
      ) : null}
      <div className="flex flex-col gap-[22px]">
        {displayedMessages.length === 0 ? (
          <p className="text-pretty font-serif text-[1.05rem] italic leading-relaxed text-muted-foreground">
            This conversation is empty so far.
          </p>
        ) : (
          displayedMessages.map((m) => {
            if (m.sender === "system") {
              return (
                <p
                  key={m.id}
                  ref={registerMessage(m.id)}
                  className={`scroll-mt-24 text-center text-[12px] italic text-muted-foreground/70 ${flashId === m.id ? "animate-crisis-flash rounded-2xl" : ""}`}
                >
                  {m.text}
                </p>
              );
            }
            const role = m.sender === "client" ? "user" : m.sender === "therapist" ? "therapist" : "assistant";
            const alignEnd = m.sender === "client";
            const isMarked = m.id === projectedMarkerId;
            const isCrisis = m.riskLevel === "crisis";
            const version = versions.get(m.id);

            // A crisis message reads as crisis at a glance: the Crisis pill rides
            // in a header line above the words (not floating below), the whole
            // unit sits in a warm amber frame, and the navigator can scroll it
            // into view with a gentle flash.
            const unit = (
              <div className="group/msg flex flex-col gap-1.5">
                {isCrisis ? (
                  <div className="flex">
                    <AttentionBadge kind="crisis" />
                  </div>
                ) : null}
                <MessageBubble
                  role={role}
                  text={m.text}
                  authorName={m.sender === "therapist" ? (m.authorName ?? "You") : undefined}
                  authorRelation="you"
                />
                <div className={`flex items-center gap-2 ${alignEnd ? "justify-end" : "justify-start"}`}>
                  {m.flagged ? <AttentionBadge kind="flag" /> : null}
                  <button
                    type="button"
                    onClick={() => markReadTo(m.id)}
                    disabled={markingId !== null}
                    aria-label="Mark read to here"
                    className="rounded-full px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color] duration-150 hover:bg-accent/10 hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/msg:opacity-100 disabled:opacity-40 [@media(pointer:coarse)]:opacity-100"
                  >
                    {isMarked ? "Reviewed to here" : "Mark read to here"}
                  </button>
                </div>
                {/* Always visible when the message branches — the therapist can
                    walk every version locally, without ever moving the client's
                    active leaf. */}
                {version ? (
                  <div className={`flex ${alignEnd ? "justify-end" : "justify-start"}`}>
                    <ReadingVersionSwitcher
                      index={version.index}
                      count={version.count}
                      onPrev={() => goToSibling(version.siblings, version.index - 1)}
                      onNext={() => goToSibling(version.siblings, version.index + 1)}
                    />
                  </div>
                ) : null}
              </div>
            );
            return (
              <Fragment key={m.id}>
                {isCrisis ? (
                  <div
                    data-crisis="true"
                    ref={registerMessage(m.id)}
                    className={`cp-crisis scroll-mt-24 rounded-2xl rounded-l-md border border-l-[3px] px-4 py-3.5 ${flashId === m.id ? "animate-crisis-flash" : ""}`}
                  >
                    {unit}
                  </div>
                ) : (
                  // A plain wrapper carrying the scroll target + flash for
                  // ordinary messages, so a digest anchor can land here too.
                  <div
                    ref={registerMessage(m.id)}
                    className={`scroll-mt-24 ${flashId === m.id ? "animate-crisis-flash rounded-2xl" : ""}`}
                  >
                    {unit}
                  </div>
                )}
                {isMarked ? <ReviewDivider /> : null}
              </Fragment>
            );
          })
        )}
      </div>

      {markError ? (
        <p role="alert" className="mt-3 text-center font-serif text-[12.5px] italic text-crisis-muted">
          {markError}
        </p>
      ) : null}

      <form
        onSubmit={send}
        className="cp-notice mt-10 flex flex-col gap-2.5 rounded-2xl border px-5 py-4 shadow-sm"
      >
        <p className="text-[12.5px] font-medium text-foreground">
          This will appear as you — a human, not the AI.
        </p>
        {sendError ? (
          <p role="alert" className="font-serif text-[12.5px] italic leading-relaxed text-crisis-muted">
            {sendError}
          </p>
        ) : null}
        <textarea
          aria-label="Write a message as yourself"
          placeholder="Speak to them directly."
          value={body}
          maxLength={8000}
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
            disabled={!body.trim() || sending}
            title={composeSubmitTitle("send", isMac)}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground shadow-sm outline-none transition-[background-color,opacity,scale] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send as yourself"}
          </button>
        </div>
      </form>

      {/* Back to the client, echoed at the foot for the long-scroll reader.
          A client-side Link, not a plain <a> — a hard navigation here forces
          a fresh document load and hydration cycle right before the note
          composers below become interactive, which is exactly the kind of
          gap a fast typist (or a test) can race past. */}
      <div className="mt-6 text-center">
        <Link
          href={`/therapist/clients/${clientId}`}
          className="text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-accent focus-visible:text-accent"
        >
          Back to their conversations
        </Link>
      </div>
    </div>
  );
}

// The therapist's own review line, echoing the client-side divider: a quiet
// accent hairline, "reviewed up to here" — not an alarm.
function ReviewDivider() {
  return (
    <div role="separator" aria-label="Your review line" className="flex items-center gap-3">
      <span aria-hidden className="h-px flex-1 bg-accent/25" />
      <span className="whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.09em] text-accent/90">
        Reviewed up to here
      </span>
      <span aria-hidden className="h-px flex-1 bg-accent/25" />
    </div>
  );
}
