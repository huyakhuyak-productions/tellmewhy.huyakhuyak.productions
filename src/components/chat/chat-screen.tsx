"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { harvestFailedSend, mergeRestoredDraft, partsToText } from "@/lib/send-recovery";
import { MessageBubble } from "./message-bubble";
import { MessageFlag } from "./message-flag";
import { MessageKeep } from "./message-keep";
import { ShareControl } from "./share-control";
import { CrisisBanner } from "./crisis-banner";
import { ConversationRail, type RailConversation, type RailFolder } from "./conversation-rail";
import { StatsRail, type ChatStats, type MoodTrend, type TherapistRailState } from "./stats-rail";
import { ThoughtRecordAffordance } from "./thought-record-affordance";
import { PublicNoteCard } from "@/components/public-note-card";

export type InitialMessage = {
  id: string;
  sender: string;
  text: string;
  /** Therapist messages only — the author's display name. */
  authorName?: string | null;
  /** Client messages only — set once the person flagged it for their therapist. */
  flaggedAt?: Date | null;
};

export type ActiveLink = { therapistName: string };

export type ReviewMarker = { lastReviewedMessageId: string; therapistName: string };

export type ConversationNote = { id: string; body: string; therapistName: string; createdAt: Date };

// The composer autosize lives outside the component so effects can re-measure
// after a programmatic restore without becoming a hook dependency.
function resizeComposer(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

// A failed send, kept as an object (not a plain string) so every failure gets
// a fresh identity — consecutive identical failures must still re-run the
// restore/focus effect below.
type SendFailure = { kind: "rate-limit" | "generic" };

export function ChatScreen({
  conversationId,
  initialMessages,
  conversations,
  folders,
  stats,
  activeLink,
  shared,
  sharedIds,
  keptMessageIds,
  reviewMarker,
  publicNotes,
  therapist,
  mood,
}: {
  conversationId: string;
  initialMessages: InitialMessage[];
  conversations: RailConversation[];
  folders: RailFolder[];
  stats: ChatStats;
  /** The client's active trusted-person link, if any — gates every share affordance. */
  activeLink: ActiveLink | null;
  /** Whether THIS conversation is currently shared under that link. */
  shared: boolean;
  /** Ids of all conversations currently shared — the rail's quiet shared-marks. */
  sharedIds: string[];
  /** Ids of messages the person has already kept as a private note. */
  keptMessageIds: string[];
  /** The therapist's review divider position, if they've reviewed here. */
  reviewMarker: ReviewMarker | null;
  /** Notes the therapist published under this conversation. */
  publicNotes: ConversationNote[];
  /** Link + shared-count summary for the stats rail's (now live) panel. */
  therapist: TherapistRailState;
  /** The client's own recent mood check-ins for the rail's trend sparkline. */
  mood: MoodTrend;
}) {
  // Server-loaded messages carry facts useChat's own array can't (real sender,
  // therapist author name, flagged state). Key them by id so the render below
  // can recover those facts even though useChat only knows user/assistant roles.
  const metaById = new Map(initialMessages.map((m) => [m.id, m]));
  const keptIds = new Set(keptMessageIds);
  const hasActiveLink = activeLink !== null;
  const therapistName = activeLink?.therapistName ?? null;
  const [crisis, setCrisis] = useState(false);
  const [sendFailure, setSendFailure] = useState<SendFailure | null>(null);
  // Whether the most recent /api/chat response was the rate limiter's 429.
  // The transport surfaces failures as a thrown Error carrying only the raw
  // body text, so the custom fetch below (the established interception point,
  // like x-risk-level) is the reliable place to read the status code.
  const rateLimited = useRef(false);
  const draftKey = `tellmewhy:draft:${conversationId}`;
  // The failure handler runs inside the SDK's onError callback (an external
  // event, not an effect — the lint-endorsed place to set state) but needs
  // the freshest thread/setters, so each render re-syncs it through this ref
  // (same pattern as conversationsRef below; refs must not be written during
  // render, so the sync lives in its own effect).
  const failureHandlerRef = useRef<() => void>(() => {});
  const { messages, sendMessage, setMessages, status } = useChat({
    // react-hooks/refs flags the rateLimited write inside the custom fetch
    // below: the rule cannot see when a render-created closure runs, so it
    // only trusts on*-named props. This wrapper only ever runs at request
    // time (the same moment the allowed onError/onFinish callbacks fire),
    // never during render, so the write is safe — a false positive. The
    // sync-in-own-effect pattern used for conversationsRef doesn't apply:
    // that cures ref writes DURING render, while this is an event-time write
    // the rule merely can't classify.
    // eslint-disable-next-line react-hooks/refs
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => {
        const last = messages[messages.length - 1];
        return { body: { conversationId, text: partsToText(last.parts) } };
      },
      fetch: async (input, init) => {
        // Reset before the attempt: a thrown fetch (offline) after an earlier
        // 429 must not inherit the rate-limit copy and lose the Retry button.
        rateLimited.current = false;
        const res = await fetch(input, init);
        rateLimited.current = res.status === 429;
        if (res.headers.get("x-risk-level") === "crisis") setCrisis(true);
        return res;
      },
    }),
    messages: initialMessages.map((m) => ({
      id: m.id,
      role: m.sender === "client" ? ("user" as const) : ("assistant" as const),
      parts: [{ type: "text" as const, text: m.text }],
    })),
    onError: () => failureHandlerRef.current(),
    onFinish: ({ isError, isAbort }) => {
      // Clear the stashed hero draft only on a confirmed clean finish. This
      // is the earliest signal that can no longer be followed by a failure of
      // the same exchange — a first streamed token would be a false success
      // when the stream dies mid-way (onFinish then fires with isError set).
      // Waiting costs nothing: the key is only ever read on mount.
      if (!isError && !isAbort) sessionStorage.removeItem(draftKey);
    },
  });

  const router = useRouter();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const isFirstRender = useRef(true);
  const sentDraft = useRef(false);
  const titleWatchStarted = useRef(false);
  // Owns the running poll's lifetime (timers + fetch loop) once armed below.
  // Cancelled ONLY by the mount-scoped unmount effect, never by re-runs of
  // the arming effect — see both effects for why that split matters.
  const titleWatchControllerRef = useRef<{ cancel: () => void } | null>(null);

  // The rail/home re-render (and hand this component a brand-new
  // `conversations` array) on every `router.refresh()` — including ones
  // triggered by DnD, rename, or folder actions on OTHER rows that have
  // nothing to do with this conversation. The title watcher below must
  // survive those refreshes, so it reads `conversations` through this ref
  // instead of depending on the prop directly (see the effect for why). The
  // sync happens in its own effect (declared ahead of the watcher, so it
  // always commits first) rather than inline during render, since refs must
  // not be written while rendering (react-hooks/refs).
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  });

  const isBusy = status === "submitted" || status === "streaming";

  // Consume the first message the home hero stashed for this conversation. The
  // ref guard makes this fire exactly once even though `sendMessage`'s identity
  // changes across renders (which would otherwise re-run this effect). The key
  // is deliberately NOT removed here: it is cleared on a confirmed clean finish
  // (onFinish above) or when a failure restores the words into the composer
  // (the failure handler below) — deleting it before the send would make a
  // failed hand-off lose the writer's first message forever.
  useEffect(() => {
    if (sentDraft.current) return;
    const stashed = sessionStorage.getItem(draftKey);
    if (stashed) {
      sentDraft.current = true;
      sendMessage({ text: stashed });
    }
  }, [draftKey, sendMessage]);

  // A failed send must never cost the writer their words. When the SDK
  // reports an error, move the failed message (and any partial reply the
  // dying stream left behind) out of the thread and back into the composer,
  // then surface a calm notice. sendMessage always appends a fresh user
  // message, so leaving the failed copy in the thread would duplicate it on
  // retry. The thread read is safe: sendMessage pushes the user message and
  // React commits (re-syncing this ref) before the request can possibly fail.
  useEffect(() => {
    failureHandlerRef.current = () => {
      const failure = harvestFailedSend(messages);
      if (failure) {
        setDraft((current) => mergeRestoredDraft(failure.failedText, current));
        setMessages(failure.messagesWithoutFailure);
        // The words now live in the composer — the stashed hero draft (if
        // any) is recovered and must not auto-resend on a later remount.
        sessionStorage.removeItem(draftKey);
      }
      setSendFailure({ kind: rateLimited.current ? "rate-limit" : "generic" });
    };
  });

  // The crisis card docks just above the composer, but the composer's height
  // is not static: the failure notice (and the textarea's own autosize) can
  // grow the form past any fixed offset, which would paint the card over the
  // recovery affordance. Publish the form's real height as a CSS variable on
  // the column — custom properties inherit into both banner variants (the
  // fixed mobile card is still a DOM child of the column) — so the card
  // always clears the composer, whatever its height.
  useEffect(() => {
    const column = columnRef.current;
    const form = composerFormRef.current;
    if (!column || !form) return;
    const sync = () =>
      column.style.setProperty("--composer-height", `${form.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  // Restoring words programmatically bypasses the textarea's onChange
  // autosize, so re-measure — and hand focus back so the writer can edit or
  // resend immediately. Keyed on the failure object's identity: it is fresh
  // per failure, so consecutive identical failures still re-run this.
  useEffect(() => {
    if (!sendFailure) return;
    const el = textareaRef.current;
    if (!el) return;
    resizeComposer(el);
    el.focus();
  }, [sendFailure]);

  // The auto-title lands server-side some time after the stream closes (a
  // fire-and-forget classify+rename call — see /api/chat). Rather than hold
  // the response stream open (which would keep the composer disabled), watch
  // for it client-side: once THIS session's first exchange finishes, poll
  // GET /api/conversations for a title change and refresh exactly once.
  //
  // ARMING is the only thing this effect reacts to — it must NOT own the
  // poll's cancellation. It used to: the poll's timers were cleared by this
  // effect's own cleanup, which runs on every re-run, including the one
  // triggered by a fast follow-up send (`messages.length`/`status` are both
  // deps, so sending a second message before the poll finished re-ran this
  // effect, whose cleanup cancelled the in-flight timer — then the
  // `titleWatchStarted` guard immediately blocked any restart, killing the
  // watcher for good). Now this effect only ever arms once (guarded below)
  // and stashes a cancel() for the poll in a ref; the poll's actual lifetime
  // is owned by the mount-scoped effect further down, whose cleanup fires
  // ONLY on unmount.
  useEffect(() => {
    if (titleWatchStarted.current) return;
    if (initialMessages.length > 1) return;
    if (messages.length < 2 || status !== "ready") return;
    titleWatchStarted.current = true;

    // What the rail/home are currently showing for this conversation (from
    // the server render before this exchange). A fast rename can land before
    // this effect even gets to run its own baseline fetch below — in that
    // case the "baseline" would already be the new title and would never
    // appear to change on its own, so this is the reference a real change
    // must diverge from. Read via the ref, not the `conversations` prop
    // directly: this effect intentionally does NOT depend on `conversations`
    // (see below), so the prop binding here would otherwise be stale.
    const displayedTitle = conversationsRef.current.find(
      (c) => c.id === conversationId,
    )?.title;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    titleWatchControllerRef.current = {
      cancel: () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      },
    };

    async function currentTitle(): Promise<string | undefined> {
      try {
        const res = await fetch("/api/conversations");
        if (!res.ok) return undefined;
        const list = (await res.json()) as { id: string; title: string }[];
        return list.find((c) => c.id === conversationId)?.title;
      } catch {
        return undefined;
      }
    }

    function poll(baseline: string | undefined, attempt: number) {
      timer = setTimeout(async () => {
        if (cancelled) return;
        const latest = await currentTitle();
        if (cancelled) return;
        if (latest !== undefined && latest !== baseline) {
          router.refresh();
          return;
        }
        if (attempt < 6) poll(baseline, attempt + 1);
      }, 1500);
    }

    void (async () => {
      const baseline = await currentTitle();
      if (cancelled) return;
      if (baseline !== undefined && baseline !== displayedTitle) {
        router.refresh();
        return;
      }
      poll(baseline, 1);
    })();

    // Deliberately no cleanup returned here — see the mount-scoped effect
    // below, which owns cancellation instead.
    // `conversations` is deliberately excluded from the deps below: the rail
    // hands us a fresh array identity on every `router.refresh()` (including
    // refreshes from unrelated rows — a drag, rename, or folder move
    // elsewhere), which would re-run this effect on every such refresh. A
    // re-run is now harmless (the `titleWatchStarted` guard just returns
    // early), but there is still no reason to depend on a prop this effect
    // never reads directly — read the latest value via `conversationsRef`
    // instead (exhaustive-deps doesn't flag this: the ref read isn't a
    // reactive dependency).
  }, [initialMessages.length, messages.length, status, conversationId, router]);

  // Owns the title poll's cancellation. Mount-scoped ([] deps) on purpose:
  // this cleanup must run ONLY when ChatScreen actually unmounts (navigating
  // away mid-poll) — never when the arming effect above re-runs. That split
  // is the fix for the fast-follow-up-send bug described there: the poll's
  // lifetime is no longer coupled to `messages.length`/`status` churn.
  useEffect(() => {
    return () => {
      titleWatchControllerRef.current?.cancel();
    };
  }, []);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: isFirstRender.current ? "auto" : "smooth",
      block: "end",
    });
    isFirstRender.current = false;
  }, [messages, status]);

  function submit() {
    if (!draft.trim() || isBusy) return;
    setSendFailure(null);
    sendMessage({ text: draft });
    setDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function onSend(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  // Drop a fixed line into the composer (the thought-record walk-through) and
  // hand focus back with the caret at the end. Words already in the composer
  // are never clobbered — the line is appended beneath them instead (the kinder
  // option: the half-typed thought stays, and the request rides along with it).
  // A programmatic value set bypasses the textarea's onChange autosize, so
  // re-measure on the next frame.
  function seedComposer(text: string) {
    const existing = draft.trimEnd();
    const next = existing ? `${existing}\n\n${text}` : text;
    setDraft(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      resizeComposer(el);
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  }

  const waiting = status === "submitted";

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[260px_minmax(0,1fr)_280px]">
      <ConversationRail
        conversations={conversations}
        folders={folders}
        currentId={conversationId}
        sharedIds={sharedIds}
        hasActiveLink={hasActiveLink}
        className="hidden lg:flex"
      />

      {/* Center: the reading-optimized column. On mobile it is the whole screen
          (the old single-column layout); on lg it fills the middle grid track
          and anchors the docked support card. */}
      <div
        ref={columnRef}
        className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col lg:mx-0 lg:h-dvh lg:min-h-0 lg:max-w-none"
      >
        <header className="cp-hairline sticky top-0 z-10 flex items-center gap-1 border-b bg-background/80 px-3 py-2.5 backdrop-blur-md lg:px-10 lg:py-4">
          <div className="mx-auto flex w-full max-w-[760px] items-center gap-1">
            <Link
              href="/chat"
              aria-label="Back to your conversations"
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.96] lg:hidden"
            >
              <svg viewBox="0 0 16 16" fill="none" className="size-[1.15rem]" aria-hidden>
                <path
                  d="M10 3.5 5.5 8l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <span className="font-serif text-[0.95rem] italic text-muted-foreground">
              A quiet place to think
            </span>
            {hasActiveLink ? (
              <div className="ml-auto">
                <ShareControl
                  conversationId={conversationId}
                  shared={shared}
                  therapistName={therapistName!}
                />
              </div>
            ) : null}
          </div>
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-5 lg:px-10 lg:py-8">
          <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-3 lg:gap-[22px]">
            {messages.map((m) => {
              const meta = metaById.get(m.id);
              // useChat only knows user/assistant; the server-loaded meta is the
              // source of truth for whether a message is really the therapist's.
              const sender = meta?.sender ?? (m.role === "user" ? "client" : "ai");
              const text = partsToText(m.parts);
              const divider =
                reviewMarker && m.id === reviewMarker.lastReviewedMessageId ? (
                  <ReviewDivider therapistName={reviewMarker.therapistName} />
                ) : null;

              let bubble: React.ReactNode;
              if (sender === "therapist") {
                bubble = (
                  <MessageBubble
                    role="therapist"
                    text={text}
                    authorName={meta?.authorName ?? "Your therapist"}
                  />
                );
              } else if (sender === "client") {
                bubble = (
                  <div className="group/msg flex flex-col">
                    <MessageBubble role="user" text={text} />
                    {/* Keep and flag act on persisted messages only — a
                        just-sent message has no server id yet. Both live in the
                        right-aligned action row under the person's own bubble. */}
                    {meta ? (
                      <>
                        <div className="flex justify-end">
                          <MessageKeep messageId={m.id} initialKept={keptIds.has(m.id)} />
                        </div>
                        {hasActiveLink ? (
                          <MessageFlag
                            conversationId={conversationId}
                            messageId={m.id}
                            initialFlagged={meta.flaggedAt != null}
                            shared={shared}
                            therapistName={therapistName!}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              } else {
                // The group/msg wrapper is what reveals the hover affordance, so
                // AI messages need it too (client bubbles already had it). Keep
                // stays left-aligned here and only shows on persisted messages —
                // a still-streaming reply has no server id yet.
                bubble = (
                  <div className="group/msg flex flex-col">
                    <MessageBubble role="assistant" text={text} />
                    {meta ? (
                      <MessageKeep messageId={m.id} initialKept={keptIds.has(m.id)} />
                    ) : null}
                  </div>
                );
              }

              return (
                <Fragment key={m.id}>
                  {bubble}
                  {divider}
                </Fragment>
              );
            })}
            {publicNotes.length > 0 && (
              <div className="mt-2 flex flex-col gap-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Notes from your therapist
                </div>
                {publicNotes.map((n) => (
                  <PublicNoteCard
                    key={n.id}
                    therapistName={n.therapistName}
                    body={n.body}
                    createdAt={n.createdAt}
                  />
                ))}
              </div>
            )}
            {waiting && (
              <div
                aria-hidden
                className="animate-message-rise mr-auto flex max-w-[88%] items-center gap-1.5 rounded-2xl rounded-bl-md bg-muted px-4 py-3.5 shadow-sm"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:200ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:400ms]" />
              </div>
            )}
            <div ref={bottomRef} className="h-px shrink-0" />
          </div>
        </div>

        {crisis && <CrisisBanner onDismiss={() => setCrisis(false)} />}

        <form
          ref={composerFormRef}
          onSubmit={onSend}
          className="cp-hairline sticky bottom-0 border-t bg-background/85 px-3 py-3 backdrop-blur-md lg:px-10 lg:pb-6 lg:pt-3"
        >
          {sendFailure && (
            <div
              role="alert"
              className="cp-notice animate-message-rise mx-auto mb-2.5 flex w-full max-w-[760px] items-center gap-3 rounded-2xl border px-4 py-2 shadow-sm"
            >
              <p className="flex-1 py-1 font-serif text-[0.9rem] italic leading-relaxed text-muted-foreground">
                {sendFailure.kind === "rate-limit"
                  ? "Take a breath — a moment before the next message."
                  : "That didn't send. Your words are safe below — try again."}
              </p>
              {sendFailure.kind === "generic" && (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!draft.trim() || isBusy}
                  className="shrink-0 rounded-lg px-3.5 py-2.5 text-[0.85rem] font-medium text-accent outline-none transition-[background-color,opacity] duration-150 hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
                >
                  Try again
                </button>
              )}
            </div>
          )}
          <ThoughtRecordAffordance
            conversationId={conversationId}
            canExtract={messages.length >= 2}
            onSeed={seedComposer}
          />
          <div className="mx-auto flex w-full max-w-[760px] items-end gap-2">
            <textarea
              ref={textareaRef}
              className="max-h-35 min-h-11 flex-1 resize-none rounded-2xl border bg-card px-4 py-2.5 text-[0.975rem] leading-relaxed shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              placeholder="What's on your mind?"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                resizeComposer(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
            />
            <button
              type="submit"
              aria-label="Send"
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm outline-none transition-[transform,background-color,opacity] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40"
              disabled={isBusy}
            >
              <svg viewBox="0 0 20 20" fill="none" className="size-[1.15rem]" aria-hidden>
                <path
                  d="M4 10h11m0 0-4.5-4.5M15 10l-4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </form>
      </div>

      <StatsRail stats={stats} therapist={therapist} mood={mood} className="hidden lg:flex" />
    </div>
  );
}

// The therapist's review line, rendered at the marked message. A quiet accent
// hairline with a centered label — "you've been seen up to here", not an alarm.
function ReviewDivider({ therapistName }: { therapistName: string }) {
  return (
    <div
      role="separator"
      aria-label={`Reviewed by ${therapistName} up to here`}
      className="my-1 flex items-center gap-3"
    >
      <span aria-hidden className="h-px flex-1 bg-accent/25" />
      <span className="whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.09em] text-accent/90">
        Reviewed by {therapistName} up to here
      </span>
      <span aria-hidden className="h-px flex-1 bg-accent/25" />
    </div>
  );
}
