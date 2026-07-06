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
 * the recent cards it narrows. Filtering is entirely client-side — `null` is
 * the "All" state. The chip row is skipped when the user keeps no folders.
 */
export function FolderChips({
  folders,
  recent,
}: {
  folders: Folder[];
  recent: RecentItem[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const shown = active === null ? recent : recent.filter((r) => r.folderId === active);

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
              <RecentCard item={item} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
