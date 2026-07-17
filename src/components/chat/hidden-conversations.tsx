"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { relativeTime } from "@/lib/relative-time";

export type HiddenConversation = {
  id: string;
  title: string;
  /** When the person hid it — drives the quiet "how long ago" line. */
  hiddenAt: Date;
};

/**
 * The "recently deleted" disclosure — the client's hidden conversations, offered
 * back for restore. Shared by the rail (desktop) and home (every viewport), so
 * both surfaces reach a hidden conversation the same way. Collapsed by default:
 * hiding is meant to quiet the list, so the restore drawer stays out of the way
 * until asked for. Renders NOTHING when nothing is hidden — no empty shell.
 */
export function HiddenConversations({
  conversations,
  className = "",
}: {
  conversations: HiddenConversation[];
  className?: string;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  // An empty drawer is no drawer at all — the whole section disappears until the
  // person has actually hidden something.
  if (conversations.length === 0) return null;

  async function restore(conversationId: string) {
    setError(null);
    setRestoringId(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden: false }),
      });
      if (!res.ok) {
        setError({ id: conversationId, message: "Couldn't restore — try again." });
        return;
      }
      router.refresh();
    } catch {
      // Offline / network failure — surfaced like a non-OK response so a restore
      // never dies silently.
      setError({ id: conversationId, message: "Couldn't restore — try again." });
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 rounded-md px-3 pb-1 pt-3.5 text-left text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground/80 outline-none transition-colors duration-150 hover:text-muted-foreground focus-visible:text-muted-foreground"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          aria-hidden
          className="opacity-70 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}
        >
          <path d="M1.5 2.5 4 5l2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Hidden
        <span className="tabular-nums font-normal tracking-normal text-muted-foreground/60">
          {conversations.length}
        </span>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          {conversations.map((c) => (
            <div key={c.id}>
              <div className="group/hidden relative flex items-center">
                <Link
                  href={`/chat/${c.id}`}
                  className="min-w-0 flex-1 rounded-lg px-3 py-2 outline-none transition-colors duration-150 hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <span className="block truncate text-[13px] tracking-[-0.005em] text-muted-foreground">
                    {c.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
                    Hidden{" "}
                    <span suppressHydrationWarning className="tabular-nums">
                      {relativeTime(c.hiddenAt)}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => restore(c.id)}
                  disabled={restoringId === c.id}
                  className="mr-1 shrink-0 rounded-md px-2 py-1 text-[12px] text-muted-foreground outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] disabled:opacity-50"
                >
                  {restoringId === c.id ? "Restoring…" : "Restore"}
                </button>
              </div>
              {error?.id === c.id ? (
                <p role="alert" className="px-3 pb-1 font-serif text-[11px] italic text-accent">
                  {error.message}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
