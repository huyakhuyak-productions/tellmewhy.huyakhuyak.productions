"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { relativeTime } from "@/lib/relative-time";

export type RailConversation = {
  id: string;
  title: string;
  updatedAt: Date;
  folderId: string | null;
};

export type RailFolder = { id: string; name: string };

// The "unsorted" bucket is modelled as a folder with a null id so it can share
// the same collapse + group machinery as real folders.
const UNSORTED_KEY = "__unsorted__";

export function ConversationRail({
  conversations,
  folders,
  currentId,
  className = "",
}: {
  conversations: RailConversation[];
  folders: RailFolder[];
  currentId: string;
  className?: string;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ id: string; message: string } | null>(null);

  const currentFolderId = conversations.find((c) => c.id === currentId)?.folderId ?? null;
  const unsorted = conversations.filter((c) => c.folderId === null);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function move(conversationId: string, folderId: string | null) {
    setMoveError(null);
    setMovingId(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) {
        setMoveError({ id: conversationId, message: "Couldn't move — try again." });
        return;
      }
      router.refresh();
    } catch {
      // Offline / network failure — same message as a non-OK response so the
      // move never fails silently.
      setMoveError({ id: conversationId, message: "Couldn't move — try again." });
    } finally {
      setMovingId(null);
    }
  }

  async function submitFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setFolderError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setFolderError("Couldn't create the folder — try again.");
        return;
      }
      setNewName("");
      setCreating(false);
      router.refresh();
    } catch {
      setFolderError("Couldn't create the folder — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className={`cp-edge flex flex-col overflow-y-auto px-3 pb-4 pt-12 lg:border-r ${className}`}
    >
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        Conversations
      </div>

      {folders.map((f) => (
        <FolderGroup
          key={f.id}
          label={f.name}
          collapsed={collapsed.has(f.id)}
          onToggle={() => toggle(f.id)}
          items={conversations.filter((c) => c.folderId === f.id)}
          currentId={currentId}
          currentFolderId={currentFolderId}
          folders={folders}
          onMove={move}
          movingId={movingId}
          moveError={moveError}
        />
      ))}

      {unsorted.length > 0 && (
        <FolderGroup
          label="unsorted"
          collapsed={collapsed.has(UNSORTED_KEY)}
          onToggle={() => toggle(UNSORTED_KEY)}
          items={unsorted}
          currentId={currentId}
          currentFolderId={currentFolderId}
          folders={folders}
          onMove={move}
          movingId={movingId}
          moveError={moveError}
        />
      )}

      <div className="px-2 pt-2">
        {creating ? (
          <form onSubmit={submitFolder}>
            <input
              autoFocus
              aria-label="New folder name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => {
                if (!newName.trim()) setCreating(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setNewName("");
                  setCreating(false);
                }
              }}
              disabled={busy}
              placeholder="Folder name"
              maxLength={80}
              className="w-full rounded-md border bg-card px-2.5 py-1.5 text-[12.5px] outline-none transition-[border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent disabled:opacity-60"
            />
            {folderError ? (
              <span
                role="alert"
                className="mt-1.5 block font-serif text-[11.5px] italic text-accent"
              >
                {folderError}
              </span>
            ) : null}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-1 py-1 text-[11.5px] text-muted-foreground/75 outline-none transition-colors duration-150 hover:text-accent focus-visible:text-accent active:scale-[0.97]"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            New folder
          </button>
        )}
      </div>

      <div className="mt-auto px-1 pt-3">
        <Link
          href="/chat"
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Start something new
        </Link>
      </div>
    </aside>
  );
}

function FolderGroup({
  label,
  collapsed,
  onToggle,
  items,
  currentId,
  currentFolderId,
  folders,
  onMove,
  movingId,
  moveError,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  items: RailConversation[];
  currentId: string;
  currentFolderId: string | null;
  folders: RailFolder[];
  onMove: (conversationId: string, folderId: string | null) => void;
  movingId: string | null;
  moveError: { id: string; message: string } | null;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 px-3 pb-1 pt-3.5 text-left text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground/80 outline-none transition-colors duration-150 hover:text-muted-foreground focus-visible:text-muted-foreground"
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
        {label}
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          {items.length === 0 ? (
            <p className="px-3 py-1.5 font-serif text-[12px] italic text-muted-foreground/60">
              Nothing here yet.
            </p>
          ) : (
            items.map((c) => (
              <ConversationRow
                key={c.id}
                item={c}
                selected={c.id === currentId}
                currentFolderId={currentFolderId}
                folders={folders}
                onMove={onMove}
                moving={movingId === c.id}
                error={moveError?.id === c.id ? moveError.message : null}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationRow({
  item,
  selected,
  currentFolderId,
  folders,
  onMove,
  moving,
  error,
}: {
  item: RailConversation;
  selected: boolean;
  currentFolderId: string | null;
  folders: RailFolder[];
  onMove: (conversationId: string, folderId: string | null) => void;
  moving: boolean;
  error: string | null;
}) {
  // The row lives inside the folder accordion's overflow-hidden clip, so the
  // menu is positioned `fixed` off the trigger's rect to escape that clip.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }

  const menuOpen = menu !== null;

  return (
    <div>
      <div className="group/row relative flex items-center">
        <Link
          href={`/chat/${item.id}`}
          aria-current={selected ? "page" : undefined}
          className={`min-w-0 flex-1 rounded-lg px-3 py-2 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40 ${
            selected ? "bg-accent/[0.10]" : "hover:bg-foreground/[0.04]"
          }`}
        >
          <span
            className={`block truncate text-[13px] tracking-[-0.005em] ${
              selected ? "font-medium text-foreground" : "text-muted-foreground"
            }`}
          >
            {item.title}
          </span>
          <span
            suppressHydrationWarning
            className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground/80"
          >
            {relativeTime(item.updatedAt)}
          </span>
        </Link>

        <button
          ref={triggerRef}
          type="button"
          aria-label="Move to folder"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={moving}
          onClick={() => (menuOpen ? setMenu(null) : openMenu())}
          className={`absolute right-1 flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-[opacity,color] duration-150 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.96] group-hover/row:opacity-100 disabled:pointer-events-none disabled:opacity-40 ${
            menuOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <circle cx="3.2" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="12.8" cy="8" r="1.3" />
          </svg>
        </button>

        {menu && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setMenu(null)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              role="menu"
              style={{ top: menu.top, right: menu.right }}
              className="animate-cp-pop fixed z-50 min-w-40 overflow-hidden rounded-xl border bg-card p-1 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_28px_-10px_rgba(0,0,0,0.25)]"
            >
              <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                Move to…
              </div>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="menuitem"
                  disabled={f.id === currentFolderId}
                  onClick={() => {
                    setMenu(null);
                    onMove(item.id, f.id);
                  }}
                  className="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {f.name}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                disabled={currentFolderId === null}
                onClick={() => {
                  setMenu(null);
                  onMove(item.id, null);
                }}
                className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Unsorted
              </button>
            </div>
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="px-3 pb-1 font-serif text-[11px] italic text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
}
