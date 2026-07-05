"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageBubble } from "./message-bubble";
import { CrisisBanner } from "./crisis-banner";

// Narrow the UI-message parts down to their text safely (the SDK's part union
// isn't narrowed by a bare `.filter`, so a switch keeps TypeScript honest).
function partsToText(parts: UIMessage["parts"]): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function ChatScreen({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: { id: string; sender: string; text: string }[];
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

  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isFirstRender = useRef(true);

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
    if (!draft.trim() || status === "streaming") return;
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
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/80 px-3 py-2.5 backdrop-blur-md">
        <Link
          href="/chat"
          aria-label="Back to your conversations"
          className="flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.96]"
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
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5">
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

      {crisis && <CrisisBanner onDismiss={() => setCrisis(false)} />}

      <form
        onSubmit={onSend}
        className="sticky bottom-0 flex items-end gap-2 border-t bg-background/85 px-3 py-3 backdrop-blur-md"
      >
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
          disabled={status === "streaming"}
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
      </form>
    </div>
  );
}
