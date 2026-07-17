"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { harvestFailedSend, mergeRestoredDraft, partsToText } from "@/lib/send-recovery";
import { buildChatRequestBody } from "@/lib/chat-request";
import { isAtRest, shouldAdoptServerMessages } from "@/lib/adopt-server-messages";
import { MessageBubble } from "./message-bubble";
import { MessageEdit } from "./message-edit";
import { MessageFlag } from "./message-flag";
import { MessageKeep } from "./message-keep";
import { MessageCopy } from "./message-copy";
import { VersionSwitcher } from "./version-switcher";
import { ShareControl } from "./share-control";
import { CrisisBanner } from "./crisis-banner";
import { ConversationRail, type RailConversation, type RailFolder } from "./conversation-rail";
import type { HiddenConversation } from "./hidden-conversations";
import { StatsRail, type ChatStats, type MoodTrend, type RailNote, type TherapistRailState } from "./stats-rail";
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
  /** The message this row branches from — an edit reuses it so the server
      branches from the same point (null at the conversation's root). Task 7
      threads it further; this task carries it through the type + page mapping. */
  parentId?: string | null;
};

// A message's place in its version set: 0-based position, set size, and the
// ordered sibling ids the switcher walks. Present only for branched path
// messages (server rows by construction — an optimistic send has no entry).
export type VersionEntry = { index: number; count: number; siblings: string[] };

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

// The single source of truth for turning server-loaded rows into the SDK's
// message shape — used BOTH to seed useChat on mount AND to re-seed it when the
// server's active path changes under a stationary Chat instance (see the
// adoption effect below). Keeping one mapping guarantees the two stay identical.
function seedFromInitialMessages(initialMessages: InitialMessage[]) {
  return initialMessages.map((m) => ({
    id: m.id,
    role: m.sender === "client" ? ("user" as const) : ("assistant" as const),
    parts: [{ type: "text" as const, text: m.text }],
  }));
}

export function ChatScreen({
  conversationId,
  initialMessages,
  versions,
  conversations,
  folders,
  hiddenConversations,
  hidden,
  stats,
  activeLink,
  shared,
  sharedIds,
  keptMessageIds,
  reviewMarker,
  publicNotes,
  therapist,
  mood,
  notes,
}: {
  conversationId: string;
  initialMessages: InitialMessage[];
  /** Per-message version-set info, keyed by message id. Only branched path
      messages appear — the switcher mounts exactly where an entry exists. */
  versions: Record<string, VersionEntry>;
  conversations: RailConversation[];
  folders: RailFolder[];
  /** The client's hidden conversations, for the rail's collapsed restore drawer. */
  hiddenConversations: HiddenConversation[];
  /** Whether THIS conversation is itself hidden — drives the direct-nav chip. */
  hidden: boolean;
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
  /** The three newest kept lines (body clamped server-side) for the rail's notes panel. */
  notes: RailNote[];
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
  // Restoring THIS conversation from its own hidden chip (see the header chip).
  const [restoringHidden, setRestoringHidden] = useState(false);
  const [restoreHiddenError, setRestoreHiddenError] = useState(false);
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
  // The transport is created once by useChat (held in a ref, recreated only on
  // an id change), so its closure would freeze the first render's `metaById`
  // and go stale after every `router.refresh()` — an edit of a message that
  // landed after a refresh would then lose its parent lookup. Read the meta map
  // through this ref (synced in its own effect below, refs-not-written-in-render
  // like `conversationsRef`) so the transport always sees the freshest parents.
  const metaByIdRef = useRef(metaById);
  const { messages, sendMessage, setMessages, status, stop, regenerate } = useChat({
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
      prepareSendMessagesRequest: ({ messages, trigger, messageId }) => {
        const last = messages[messages.length - 1];
        return {
          body: buildChatRequestBody({
            conversationId,
            trigger,
            messageId,
            // "" for a regenerate — no user turn rides along; the mapper ignores it.
            text: last ? partsToText(last.parts) : "",
            parentIdOf: (id) => metaByIdRef.current.get(id)?.parentId,
          }),
        };
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
    messages: seedFromInitialMessages(initialMessages),
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

  // Bring this conversation back into the list from its own hidden chip. A
  // refresh re-runs the page load, which drops the chip once the row is visible
  // again.
  async function restoreHidden() {
    setRestoreHiddenError(false);
    setRestoringHidden(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden: false }),
      });
      if (!res.ok) {
        setRestoreHiddenError(true);
        return;
      }
      router.refresh();
    } catch {
      // Offline / network failure — surfaced like a non-OK response so a restore
      // never dies silently.
      setRestoreHiddenError(true);
    } finally {
      setRestoringHidden(false);
    }
  }

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

  // Keep the transport's parent lookup fresh (see metaByIdRef above). Its own
  // effect so the ref is never written during render (react-hooks/refs).
  useEffect(() => {
    metaByIdRef.current = metaById;
  });

  // Which of the person's own messages is currently open for editing, if any.
  const [editingId, setEditingId] = useState<string | null>(null);
  // A branch operation (edit / regenerate / stop) just went out; after the
  // stream settles the server's active path is the source of truth (new ids,
  // version counts, a stopped partial gaining meta), so re-sync once via the
  // settle effect below rather than trusting the SDK's optimistic local state.
  const pendingRefresh = useRef(false);

  const isBusy = status === "submitted" || status === "streaming";

  // After a branch operation's stream settles, re-sync server truth exactly
  // once. Guarded by the ref so a plain send (or the initial ready state) never
  // triggers a refresh — only edit/regenerate/stop arm it.
  useEffect(() => {
    if (status === "ready" && pendingRefresh.current) {
      pendingRefresh.current = false;
      router.refresh();
    }
  }, [status, router]);

  // Tracks the last server render we've already reconciled against, by identity.
  // A `router.refresh()` hands us a brand-new `initialMessages` array; a plain
  // send mutates only the SDK's `messages` and leaves this prop's identity
  // untouched. Comparing identities is how the adoption effect below tells "the
  // server has new truth" apart from "the SDK is simply ahead of a stale server"
  // — the distinction that keeps a just-sent exchange from being reverted.
  const seenInitialRef = useRef(initialMessages);

  // Adopt server truth into the rendered thread. The SDK owns `messages` during
  // a stream; the server owns them at rest. useChat's Chat instance is created
  // once and survives every `router.refresh()` (the `messages:` option is an
  // initial seed only), so new server props — a switched branch, or a settled
  // edit/regenerate/stop whose rows just gained their real ids — never reach the
  // rendered SDK state on their own. When a genuinely new server render arrives
  // AND we're at rest AND the ordered id lists diverge, re-seed from the active
  // path with the exact mount mapping.
  //
  // This closes the version-switch no-op (the POST + refresh delivered new props
  // that the on-screen bubbles ignored, so meta/version lookups missed and the
  // switcher vanished) and reconciles Task 6's settle-refresh siblings (new AI
  // rows gain their server ids, so their action rows appear). Because
  // `router.refresh()` is async, adoption runs on the RE-RENDER that carries the
  // new props, not the click — hence keying on the `initialMessages` identity.
  //
  // It cannot loop or clobber: the identity guard fires it only when a new
  // server render actually landed (never on a plain send, whose props are
  // unchanged), and adopting makes the id lists equal. A refresh that lands
  // mid-stream (e.g. an unrelated rail refresh while a reply streams) carries a
  // snapshot that predates the in-flight reply, so it is consumed without
  // adopting — otherwise it would overwrite the freshly settled thread.
  //
  // "At rest" means "ready" OR the sticky "error" state (see isAtRest) — after
  // a failed send the chat rests at "error" forever, and a version switch from
  // there must still land on screen.
  useEffect(() => {
    if (initialMessages === seenInitialRef.current) return;
    if (!isAtRest(status)) {
      seenInitialRef.current = initialMessages;
      return;
    }
    seenInitialRef.current = initialMessages;
    if (
      shouldAdoptServerMessages(
        messages.map((m) => m.id),
        initialMessages.map((m) => m.id),
      )
    ) {
      setMessages(seedFromInitialMessages(initialMessages));
    }
  }, [status, initialMessages, messages, setMessages]);

  function saveEdit(id: string, text: string) {
    setEditingId(null);
    setSendFailure(null);
    pendingRefresh.current = true;
    // The SDK replaces the message in place AND truncates every message after
    // it (verified in node_modules/ai: sendMessage slices to messageIndex + 1
    // before replacing), so no manual setMessages truncate is needed here.
    sendMessage({ text, messageId: id });
  }

  function regenerateMessage(id: string) {
    setSendFailure(null);
    pendingRefresh.current = true;
    regenerate({ messageId: id });
  }

  function stopAndRefresh() {
    // A zero-token stop saves no AI row server-side, so the local partial (if
    // any) may vanish on reload — the refresh reconciles to whatever persisted.
    pendingRefresh.current = true;
    void stop();
  }

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
        hiddenConversations={hiddenConversations}
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

        {hidden ? (
          <div className="cp-hairline border-b bg-muted/30 px-4 py-2.5 lg:px-10">
            <div className="mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-x-3 gap-y-1">
              <p className="flex-1 font-serif text-[0.85rem] italic leading-relaxed text-muted-foreground">
                Hidden — only you can see your own hidden conversations.
              </p>
              <button
                type="button"
                onClick={restoreHidden}
                disabled={restoringHidden}
                className="shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-accent outline-none transition-[background-color,opacity] duration-150 hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50"
              >
                {restoringHidden ? "Restoring…" : "Restore"}
              </button>
              {restoreHiddenError ? (
                <p role="alert" className="w-full font-serif text-[11.5px] italic text-accent">
                  Couldn&apos;t restore — try again.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

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
                bubble =
                  editingId === m.id ? (
                    <MessageEdit
                      initialText={text}
                      isBusy={isBusy}
                      onSave={(next) => saveEdit(m.id, next)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <div className="group/msg flex flex-col">
                      <MessageBubble role="user" text={text} />
                      {/* Edit, keep, and flag act on persisted messages only — a
                          just-sent message has no server id yet. They live in the
                          right-aligned action row under the person's own bubble. */}
                      {meta ? (
                        <>
                          <div className="flex items-center justify-end gap-1">
                            <HoverAction
                              label="Edit this message"
                              text="Edit"
                              onClick={() => setEditingId(m.id)}
                              disabled={isBusy}
                              icon={
                                <path
                                  d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3L11 2.5Z"
                                  stroke="currentColor"
                                  strokeWidth="1.3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              }
                            />
                            <MessageCopy text={text} />
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
                          {/* An edited message branches versions from its
                              parent — the arrows are always visible so the
                              other versions stay discoverable. */}
                          {versions[m.id] ? (
                            <div className="flex justify-end">
                              <VersionSwitcher
                                messageId={m.id}
                                index={versions[m.id]!.index}
                                count={versions[m.id]!.count}
                                siblings={versions[m.id]!.siblings}
                                conversationId={conversationId}
                              />
                            </div>
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
                      <div className="flex items-center gap-1">
                        <HoverAction
                          label="Regenerate this reply"
                          text="Regenerate"
                          onClick={() => regenerateMessage(m.id)}
                          disabled={isBusy}
                          icon={
                            <path
                              d="M12.5 6.5A5 5 0 1 0 13 9.5M12.5 3v3.5H9"
                              stroke="currentColor"
                              strokeWidth="1.3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          }
                        />
                        <MessageCopy text={text} />
                        <MessageKeep messageId={m.id} initialKept={keptIds.has(m.id)} />
                      </div>
                    ) : null}
                    {/* A regenerated reply branches versions from the same user
                        turn — the arrows walk between them, always visible. */}
                    {meta && versions[m.id] ? (
                      <VersionSwitcher
                        messageId={m.id}
                        index={versions[m.id]!.index}
                        count={versions[m.id]!.count}
                        siblings={versions[m.id]!.siblings}
                        conversationId={conversationId}
                      />
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
            {/* While a stream is in flight the send button becomes a Stop
                control — same geometry, so the composer never shifts. Stop
                aborts and re-syncs server truth; a zero-token stop saves no AI
                row, so the refresh reconciles to whatever actually persisted. */}
            {isBusy ? (
              <button
                type="button"
                aria-label="Stop generating"
                onClick={stopAndRefresh}
                className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm outline-none transition-[transform,background-color,opacity] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.94]"
              >
                <svg viewBox="0 0 20 20" fill="none" className="size-[1.15rem]" aria-hidden>
                  <rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm outline-none transition-[transform,background-color,opacity] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40"
                disabled={!draft.trim()}
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
            )}
          </div>
        </form>
      </div>

      <StatsRail stats={stats} therapist={therapist} mood={mood} notes={notes} className="hidden lg:flex" />
    </div>
  );
}

// A hover-revealed message action (Edit / Regenerate) sharing the quiet idiom
// of the Keep affordance: invisible until the message is hovered or the button
// is focused, so the reading column stays calm. The icon is the caller's <path>
// inside a shared 16-box svg.
function HoverAction({
  label,
  text,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  text: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground/70 opacity-0 outline-none transition-[opacity,color] duration-150 hover:text-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 group-hover/msg:opacity-100 disabled:pointer-events-none disabled:opacity-40"
    >
      <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden>
        {icon}
      </svg>
      {text}
    </button>
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
