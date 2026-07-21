"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { focusAfterDestructive, useConfirmFocus } from "@/components/ui/destructive-focus";
import { GENTLE_PACE } from "@/lib/pacing-copy";
import { relativeTime } from "@/lib/relative-time";
import { setConversationDragData, useConversationDropTarget } from "@/lib/dnd";
import { shareConversation, stopSharingConversation } from "@/lib/sharing-client";
import { HiddenConversations, type HiddenConversation } from "./hidden-conversations";

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
  sharedIds = [],
  hasActiveLink = false,
  hiddenConversations = [],
  className = "",
}: {
  conversations: RailConversation[];
  folders: RailFolder[];
  currentId: string;
  /** Ids currently shared with the trusted person — drives the quiet mark. */
  sharedIds?: string[];
  /** Whether a share/stop-share action should appear in the row menu at all. */
  hasActiveLink?: boolean;
  /** The client's hidden conversations, for the collapsed restore drawer. */
  hiddenConversations?: HiddenConversation[];
  className?: string;
}) {
  const router = useRouter();
  const sharedSet = new Set(sharedIds);
  const [shareError, setShareError] = useState<{ id: string; message: string } | null>(null);

  async function toggleShare(conversationId: string, currentlyShared: boolean) {
    setShareError(null);
    const ok = currentlyShared
      ? await stopSharingConversation(conversationId)
      : await shareConversation(conversationId);
    if (ok) router.refresh();
    else setShareError({ id: conversationId, message: "Couldn't update sharing — try again." });
  }
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ id: string; message: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<{ id: string; message: string } | null>(null);
  const [hidingId, setHidingId] = useState<string | null>(null);
  const [hideError, setHideError] = useState<{ id: string; message: string } | null>(null);

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

  // A conversation dropped onto a folder heading files it there. Same folder =
  // no-op: skip the PATCH silently so an accidental in-place drop is a no-event.
  function handleDrop(conversationId: string, folderId: string | null) {
    const current = conversations.find((c) => c.id === conversationId)?.folderId ?? null;
    if (current === folderId) return;
    move(conversationId, folderId);
  }

  async function rename(conversationId: string, title: string): Promise<boolean> {
    setRenameError(null);
    setRenamingId(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setRenameError({ id: conversationId, message: "Couldn't rename — try again." });
        return false;
      }
      router.refresh();
      return true;
    } catch {
      // Offline / network failure — surfaced the same way as a non-OK response
      // so a rename never dies silently.
      setRenameError({ id: conversationId, message: "Couldn't rename — try again." });
      return false;
    } finally {
      setRenamingId(null);
    }
  }

  async function hide(conversationId: string) {
    setHideError(null);
    setHidingId(conversationId);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden: true }),
      });
      if (!res.ok) {
        setHideError({
          id: conversationId,
          message: res.status === 429 ? GENTLE_PACE : "Couldn't hide — try again.",
        });
        return;
      }
      router.refresh();
    } catch {
      // Offline / network failure — surfaced the same way as a non-OK response
      // so a hide never dies silently.
      setHideError({ id: conversationId, message: "Couldn't hide — try again." });
    } finally {
      setHidingId(null);
    }
  }

  async function submitFolder(e: React.SubmitEvent) {
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
    /* lg:h-dvh is load-bearing: the rail sits in an implicit `auto` grid row,
       so without a definite height overflow-y-auto never engages and a long
       list grows the row — and the whole page — past the viewport. */
    <aside
      className={`cp-edge flex flex-col overflow-y-auto px-3 pb-4 pt-12 lg:h-dvh lg:border-r ${className}`}
    >
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        Conversations
      </div>

      {folders.map((f) => (
        <FolderGroup
          key={f.id}
          label={f.name}
          folderId={f.id}
          onDropConversation={handleDrop}
          collapsed={collapsed.has(f.id)}
          onToggle={() => toggle(f.id)}
          items={conversations.filter((c) => c.folderId === f.id)}
          currentId={currentId}
          currentFolderId={currentFolderId}
          folders={folders}
          onMove={move}
          movingId={movingId}
          moveError={moveError}
          onRename={rename}
          renamingId={renamingId}
          renameError={renameError}
          onHide={hide}
          hidingId={hidingId}
          hideError={hideError}
          sharedSet={sharedSet}
          hasActiveLink={hasActiveLink}
          onToggleShare={toggleShare}
          shareError={shareError}
        />
      ))}

      {unsorted.length > 0 && (
        <FolderGroup
          label="unsorted"
          folderId={null}
          onDropConversation={handleDrop}
          collapsed={collapsed.has(UNSORTED_KEY)}
          onToggle={() => toggle(UNSORTED_KEY)}
          items={unsorted}
          currentId={currentId}
          currentFolderId={currentFolderId}
          folders={folders}
          onMove={move}
          movingId={movingId}
          moveError={moveError}
          onRename={rename}
          renamingId={renamingId}
          renameError={renameError}
          onHide={hide}
          hidingId={hidingId}
          hideError={hideError}
          sharedSet={sharedSet}
          hasActiveLink={hasActiveLink}
          onToggleShare={toggleShare}
          shareError={shareError}
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

      <HiddenConversations conversations={hiddenConversations} />

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
        <Link
          href="/trust"
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 1.8 3 4v3.5c0 3 2.1 5.2 5 6.7 2.9-1.5 5-3.7 5-6.7V4L8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Trust &amp; sharing
        </Link>
        <Link
          href="/account"
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 8.2a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4ZM3 13.2c0-2.2 2.2-3.6 5-3.6s5 1.4 5 3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Account
        </Link>
      </div>
    </aside>
  );
}

function FolderGroup({
  label,
  folderId,
  onDropConversation,
  collapsed,
  onToggle,
  items,
  currentId,
  currentFolderId,
  folders,
  onMove,
  movingId,
  moveError,
  onRename,
  renamingId,
  renameError,
  onHide,
  hidingId,
  hideError,
  sharedSet,
  hasActiveLink,
  onToggleShare,
  shareError,
}: {
  label: string;
  folderId: string | null;
  onDropConversation: (conversationId: string, folderId: string | null) => void;
  collapsed: boolean;
  onToggle: () => void;
  items: RailConversation[];
  currentId: string;
  currentFolderId: string | null;
  folders: RailFolder[];
  onMove: (conversationId: string, folderId: string | null) => void;
  movingId: string | null;
  moveError: { id: string; message: string } | null;
  onRename: (conversationId: string, title: string) => Promise<boolean>;
  renamingId: string | null;
  renameError: { id: string; message: string } | null;
  onHide: (conversationId: string) => void;
  hidingId: string | null;
  hideError: { id: string; message: string } | null;
  sharedSet: Set<string>;
  hasActiveLink: boolean;
  onToggleShare: (conversationId: string, currentlyShared: boolean) => void;
  shareError: { id: string; message: string } | null;
}) {
  const { over, dropProps } = useConversationDropTarget((id) => onDropConversation(id, folderId));

  // A collapsed group opens after a beat of hovering a dragged conversation, so
  // you can drop into a folder you can't currently see the contents of.
  // `onToggle` is stable through a hover (the parent doesn't re-render while
  // `over` flips locally), so the timer isn't reset out from under itself.
  useEffect(() => {
    if (!over || !collapsed) return;
    const t = setTimeout(onToggle, 600);
    return () => clearTimeout(t);
  }, [over, collapsed, onToggle]);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        {...dropProps}
        className={`cp-drop flex w-full items-center gap-1.5 rounded-md px-3 pb-1 pt-3.5 text-left text-[10px] font-semibold uppercase tracking-[0.11em] outline-none focus-visible:text-muted-foreground ${
          over ? "cp-drop-over" : "text-muted-foreground/80 hover:text-muted-foreground"
        }`}
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
        {/* The 0fr collapse hides the rows visually but leaves them tabbable;
            `inert` takes a collapsed group's rows out of the tab order (and off
            the a11y tree) until it reopens. */}
        <div inert={collapsed} className="min-h-0 overflow-hidden">
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
                onRename={onRename}
                renaming={renamingId === c.id}
                renameError={renameError?.id === c.id ? renameError.message : null}
                onHide={onHide}
                hiding={hidingId === c.id}
                hideError={hideError?.id === c.id ? hideError.message : null}
                shared={sharedSet.has(c.id)}
                hasActiveLink={hasActiveLink}
                onToggleShare={onToggleShare}
                shareError={shareError?.id === c.id ? shareError.message : null}
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
  onRename,
  renaming,
  renameError,
  onHide,
  hiding,
  hideError,
  shared,
  hasActiveLink,
  onToggleShare,
  shareError,
}: {
  item: RailConversation;
  selected: boolean;
  currentFolderId: string | null;
  folders: RailFolder[];
  onMove: (conversationId: string, folderId: string | null) => void;
  moving: boolean;
  error: string | null;
  onRename: (conversationId: string, title: string) => Promise<boolean>;
  renaming: boolean;
  renameError: string | null;
  onHide: (conversationId: string) => void;
  hiding: boolean;
  hideError: string | null;
  shared: boolean;
  hasActiveLink: boolean;
  onToggleShare: (conversationId: string, currentlyShared: boolean) => void;
  shareError: string | null;
}) {
  // The row lives inside the folder accordion's overflow-hidden clip, so the
  // menu is positioned `fixed` off the trigger's rect to escape that clip.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hideItemRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const [renameMode, setRenameMode] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [dragging, setDragging] = useState(false);
  // The "Hide" menuitem swaps the popover's contents for a calm confirm instead
  // of closing it — the popover stays anchored to the row, no accordion reflow.
  const [confirmingHide, setConfirmingHide] = useState(false);

  const menuOpen = menu !== null;

  // When the confirm takes over the popover, land focus on "Keep it" (the safe
  // action) so a keyboard user never fires "Hide it" by reflex.
  const keepItRef = useConfirmFocus<HTMLButtonElement>(confirmingHide);

  // Dismissing the confirm swaps the popover back to the action list; hand focus
  // to the "Hide" item it opened from so focus never drops to <body>.
  function dismissConfirm() {
    setConfirmingHide(false);
    focusAfterDestructive(hideItemRef);
  }

  // Escape dismisses the open menu whether it was reached by mouse or keyboard —
  // a single listener covers both the Move list and the Rename entry. Scrolling
  // dismisses it too: the menu is positioned `fixed` off the trigger's rect, so
  // any scroll (the rail's own overflow scroller included) would leave it
  // stranded away from the row it belongs to.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      // Escape closes the whole menu (confirm included) and hands focus back to
      // the row's trigger so it never drops to <body>.
      if (e.key === "Escape") {
        setMenu(null);
        focusAfterDestructive(triggerRef);
      }
    }
    function onScroll() {
      setMenu(null);
    }
    document.addEventListener("keydown", onKey);
    // Capture phase: scroll events don't bubble, so this also catches the rail's
    // inner overflow-y-auto scroller moving the trigger out from under the menu.
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen]);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Always open onto the action list, never a stale confirm from last time.
    setConfirmingHide(false);
    setMenu({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }

  function startRename() {
    setMenu(null);
    setDraft(item.title);
    setRenameMode(true);
  }

  async function submitRename(e: React.SubmitEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title || renaming) return;
    if (title === item.title) {
      setRenameMode(false);
      return;
    }
    const ok = await onRename(item.id, title);
    if (ok) setRenameMode(false);
  }

  return (
    <div>
      <div
        // The row lifts onto folder headings; renaming turns it off so the
        // inline input stays selectable. A plain click still navigates — the
        // browser only starts a drag past its own movement threshold.
        draggable={!renameMode && !moving && !hiding}
        onDragStart={(e) => {
          setConversationDragData(e.dataTransfer, item.id);
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
        className={`group/row relative flex items-center transition-opacity duration-150 ${
          dragging ? "opacity-50" : ""
        }`}
      >
        {renameMode ? (
          <form onSubmit={submitRename} className="flex-1 px-2 py-1">
            <input
              autoFocus
              aria-label="Rename conversation"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (!renaming) setRenameMode(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameMode(false);
                }
              }}
              disabled={renaming}
              maxLength={200}
              className="w-full rounded-md border bg-card px-2.5 py-1.5 text-[13px] outline-none transition-[border-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-accent disabled:opacity-60"
            />
          </form>
        ) : (
          <Link
            href={`/chat/${item.id}`}
            aria-current={selected ? "page" : undefined}
            // The wrapping row owns the drag; disable the anchor's native
            // drag so it never hijacks the gesture with a link/URL payload.
            draggable={false}
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
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
              <span suppressHydrationWarning className="tabular-nums">
                {relativeTime(item.updatedAt)}
              </span>
              {shared ? (
                <span className="inline-flex items-center gap-1 text-accent/90">
                  <span aria-hidden className="size-1.5 rounded-full bg-accent/80" />
                  Shared
                  <span className="sr-only"> with your therapist</span>
                </span>
              ) : null}
            </span>
          </Link>
        )}

        {!renameMode && (
          <button
            ref={triggerRef}
            type="button"
            aria-label="Conversation actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={moving || hiding}
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
        )}

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
              role={confirmingHide ? "dialog" : "menu"}
              aria-label={confirmingHide ? "Hide conversation?" : undefined}
              style={{ top: menu.top, right: menu.right }}
              className={`animate-cp-pop fixed z-50 overflow-hidden rounded-xl border bg-card p-1 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_28px_-10px_rgba(0,0,0,0.25)] ${
                confirmingHide ? "w-64" : "min-w-40"
              }`}
            >
              {confirmingHide ? (
                <div className="p-1.5">
                  <p className="font-serif text-[12.5px] italic leading-relaxed text-muted-foreground">
                    This hides it from your view. If it&apos;s shared, your trusted
                    person can still see it. You can restore it any time.
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(null);
                        setConfirmingHide(false);
                        onHide(item.id);
                      }}
                      className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97]"
                    >
                      Hide it
                    </button>
                    <button
                      ref={keepItRef}
                      type="button"
                      onClick={dismissConfirm}
                      className="rounded-lg px-3 py-1.5 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={startRename}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05]"
                  >
                    Rename
                  </button>
                  {hasActiveLink ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        onToggleShare(item.id, shared);
                      }}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05]"
                    >
                      {shared ? "Stop sharing" : "Share with therapist"}
                    </button>
                  ) : null}
                  <div role="separator" className="mx-1 my-1 h-px bg-border/60" />
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
                  <div role="separator" className="mx-1 my-1 h-px bg-border/60" />
                  <button
                    ref={hideItemRef}
                    type="button"
                    role="menuitem"
                    onClick={() => setConfirmingHide(true)}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05]"
                  >
                    Hide
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {renameError ? (
        <p role="alert" className="px-3 pb-1 font-serif text-[11px] italic text-accent">
          {renameError}
        </p>
      ) : hideError ? (
        <p role="alert" className="px-3 pb-1 font-serif text-[11px] italic text-accent">
          {hideError}
        </p>
      ) : error ? (
        <p role="alert" className="px-3 pb-1 font-serif text-[11px] italic text-accent">
          {error}
        </p>
      ) : shareError ? (
        <p role="alert" className="px-3 pb-1 font-serif text-[11px] italic text-accent">
          {shareError}
        </p>
      ) : null}
    </div>
  );
}
