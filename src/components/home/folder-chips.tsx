"use client";

import { useState } from "react";
import { RecentCard, type RecentItem } from "./recent-card";

type Folder = { id: string; name: string };

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs outline-none transition-[color,background-color,border-color] duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97] ${
        active
          ? "border-accent/30 bg-accent/[0.07] text-accent"
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The "pick up where you left off" section: a centered folder filter row plus
 * the cards it narrows. Filtering is entirely client-side — `null` is the
 * "All" state, which shows only the 6 most recent until the reader asks for
 * more (mobile has no conversation rail, so this row is the only way to
 * reach older conversations). Selecting a folder always shows everything
 * filed there, uncapped — a full folder should never look emptier than it
 * is. The chip row is skipped when the user keeps no folders.
 */
export function FolderChips({
  folders,
  conversations,
}: {
  folders: Folder[];
  conversations: RecentItem[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const recent = conversations.slice(0, 6);
  const shown =
    active === null
      ? expanded
        ? conversations
        : recent
      : conversations.filter((c) => c.folderId === active);
  const canExpand = active === null && !expanded && conversations.length > recent.length;

  return (
    <section className="w-full max-w-[880px]">
      {folders.length > 0 ? (
        <div
          role="group"
          aria-label="Filter by folder"
          className="flex flex-wrap justify-center gap-1 pb-4"
        >
          <Chip active={active === null} onClick={() => setActive(null)}>
            All
          </Chip>
          {folders.map((f) => (
            <Chip key={f.id} active={active === f.id} onClick={() => setActive(f.id)}>
              {f.name}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="flex items-baseline justify-between px-1 pb-2.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Pick up where you left off
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="px-1 py-8 text-center font-serif text-sm italic text-muted-foreground">
          Nothing filed here yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((item, i) => (
            <div
              key={item.id}
              className="animate-message-rise h-full"
              style={{ animationDelay: `${Math.min(i, 6) * 55}ms` }}
            >
              <RecentCard item={item} folders={folders} />
            </div>
          ))}
        </div>
      )}

      {canExpand ? (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[11.5px] text-muted-foreground/75 outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent active:scale-[0.97]"
          >
            Show all {conversations.length} conversations
          </button>
        </div>
      ) : null}
    </section>
  );
}
