"use client";

import { useState } from "react";
import Link from "next/link";
import { relativeTime } from "@/lib/relative-time";
import { setConversationDragData } from "@/lib/dnd";
import { CardMenu, type CardFolder } from "./card-menu";

export type RecentItem = {
  id: string;
  title: string;
  /** null when the conversation is unsorted. */
  folderId: string | null;
  /** Resolved folder name, or null when unsorted. */
  folderName: string | null;
  updatedAt: Date;
};

export function RecentCard({
  item,
  folders,
  dndEnabled = false,
  shared = false,
  hasActiveLink = false,
}: {
  item: RecentItem;
  folders: CardFolder[];
  /** Desktop only: let the card be dragged onto a folder chip to file it. */
  dndEnabled?: boolean;
  /** Whether this conversation is currently shared with the trusted person. */
  shared?: boolean;
  /** Whether a share/stop-share action should appear in the card menu at all. */
  hasActiveLink?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      // The card lifts onto a folder chip to file it. A plain click still
      // navigates — the browser only starts a drag past its movement threshold.
      draggable={dndEnabled}
      onDragStart={
        dndEnabled
          ? (e) => {
              setConversationDragData(e.dataTransfer, item.id);
              setDragging(true);
            }
          : undefined
      }
      onDragEnd={() => setDragging(false)}
      className={`group relative h-full transition-opacity duration-150 ${
        dragging ? "opacity-50" : ""
      }`}
    >
      <Link
        href={`/chat/${item.id}`}
        // The card wrapper owns the drag; disable the anchor's native drag so
        // it never hijacks the gesture with a link/URL payload.
        draggable={false}
        className="flex h-full min-h-[112px] flex-col gap-2 rounded-[18px] border bg-card p-[18px] shadow-sm outline-none transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
      >
        {item.folderName ? (
          <div className="flex items-center">
            <span className="mr-8 whitespace-nowrap rounded-full border border-border/80 px-2 py-px text-[10px] text-muted-foreground">
              {item.folderName}
            </span>
          </div>
        ) : null}
        <span className="line-clamp-2 text-pretty pr-8 text-[0.9rem] font-semibold tracking-[-0.005em]">
          {item.title}
        </span>
        <div className="mt-auto flex items-center gap-2">
          <time suppressHydrationWarning className="text-[11px] tabular-nums text-muted-foreground">
            {relativeTime(item.updatedAt)}
          </time>
          {shared ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-accent/90">
              <span aria-hidden className="size-1.5 rounded-full bg-accent/80" />
              Shared
              <span className="sr-only"> with your therapist</span>
            </span>
          ) : null}
        </div>
      </Link>

      <CardMenu
        conversationId={item.id}
        title={item.title}
        currentFolderId={item.folderId}
        folders={folders}
        shared={shared}
        hasActiveLink={hasActiveLink}
      />
    </div>
  );
}
