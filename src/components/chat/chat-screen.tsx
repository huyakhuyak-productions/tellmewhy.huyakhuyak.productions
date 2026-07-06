"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageBubble } from "./message-bubble";
import { CrisisBanner } from "./crisis-banner";
import { ConversationRail, type RailConversation, type RailFolder } from "./conversation-rail";
import { StatsRail, type ChatStats } from "./stats-rail";

// Narrow the UI-message parts down to their text safely (the SDK's part union
// isn't narrowed by a bare `.filter`, so a switch keeps TypeScript honest).
function partsToText(parts: UIMessage["parts"]): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function ChatScreen({
  conversationId,
  initialMessages,
  conversations,
  folders,
  stats,
}: {
  conversationId: string;
  initialMessages: { id: string; sender: string; text: string }[];
  conversations: RailConversation[];
  folders: RailFolder[];
  stats: ChatStats;
}) {
  const [crisis, setCrisis] = useState(false);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => {
        const last = messages[messages.length - 1];
        return { body: { conversationId, text: partsToText(last.parts) } };
      },
      fetch: async (input, init) => {
        const res = await fetch(input, init);
        if (res.headers.get("x-risk-level") === "crisis") setCrisis(true);
        return res;
      },
    }),
    messages: initialMessages.map((m) => ({
      id: m.id,
      role: m.sender === "client" ? ("user" as const) : ("assistant" as const),
      parts: [{ type: "text" as const, text: m.text }],
    })),
  });

  const router = useRouter();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isFirstRender = useRef(true);
  const sentDraft = useRef(false);
  const titleWatchStarted = useRef(false);

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
  // changes across renders (which would otherwise re-run this effect).
  useEffect(() => {
    if (sentDraft.current) return;
    const key = `tellmewhy:draft:${conversationId}`;
    const draft = sessionStorage.getItem(key);
    if (draft) {
      sessionStorage.removeItem(key);
      sentDraft.current = true;
      sendMessage({ text: draft });
    }
  }, [conversationId, sendMessage]);

  // The auto-title lands server-side some time after the stream closes (a
  // fire-and-forget classify+rename call — see /api/chat). Rather than hold
  // the response stream open (which would keep the composer disabled), watch
  // for it client-side: once THIS session's first exchange finishes, poll
  // GET /api/conversations for a title change and refresh exactly once. The
  // ref guard keeps this from starting twice (StrictMode) and from ever
  // re-arming for later exchanges in the same mount.
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

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `conversations` is deliberately excluded: the rail hands us a fresh
    // array identity on every `router.refresh()` (including refreshes from
    // unrelated rows — a drag, rename, or folder move elsewhere), which would
    // re-run this effect, cancel the in-flight poll via the cleanup above,
    // and then immediately bail at the `titleWatchStarted` guard — killing
    // the watcher for good. Read the latest value via `conversationsRef`
    // instead so this effect only re-runs when the trigger conditions
    // actually change (exhaustive-deps doesn't flag this: the ref read isn't
    // a reactive dependency).
  }, [initialMessages.length, messages.length, status, conversationId, router]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: isFirstRender.current ? "auto" : "smooth",
      block: "end",
    });
    isFirstRender.current = false;
  }, [messages, status]);

  // Grow the composer with its content, up to a comfortable ceiling.
  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function submit() {
    if (!draft.trim() || isBusy) return;
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

  const waiting = status === "submitted";

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[260px_minmax(0,1fr)_280px]">
      <ConversationRail
        conversations={conversations}
        folders={folders}
        currentId={conversationId}
        className="hidden lg:flex"
      />

      {/* Center: the reading-optimized column. On mobile it is the whole screen
          (the old single-column layout); on lg it fills the middle grid track
          and anchors the docked support card. */}
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col lg:mx-0 lg:h-dvh lg:min-h-0 lg:max-w-none">
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
          </div>
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-5 lg:px-10 lg:py-8">
          <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-3 lg:gap-[22px]">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                role={m.role === "user" ? "user" : "assistant"}
                text={partsToText(m.parts)}
              />
            ))}
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
          onSubmit={onSend}
          className="cp-hairline sticky bottom-0 border-t bg-background/85 px-3 py-3 backdrop-blur-md lg:px-10 lg:pb-6 lg:pt-3"
        >
          <div className="mx-auto flex w-full max-w-[760px] items-end gap-2">
            <textarea
              ref={textareaRef}
              className="max-h-35 min-h-11 flex-1 resize-none rounded-2xl border bg-card px-4 py-2.5 text-[0.975rem] leading-relaxed shadow-sm outline-none transition-[box-shadow,border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              placeholder="What's on your mind?"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                resize(e.target);
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

      <StatsRail stats={stats} className="hidden lg:flex" />
    </div>
  );
}
