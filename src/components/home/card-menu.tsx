"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { focusAfterDestructive, useConfirmFocus } from "@/components/ui/destructive-focus";
import { GENTLE_PACE } from "@/lib/pacing-copy";
import { shareConversation, stopSharingConversation } from "@/lib/sharing-client";

export type CardFolder = { id: string; name: string };

/**
 * The overflow actions on a home card. Phones have no conversation rail, so
 * this is the only way to rename or refile a conversation from a small screen.
 * The card itself stays a plain link — this menu is a sibling laid over its
 * top-right corner, so opening it never navigates. Rename swaps an inline
 * input over the card face; Move refiles through the same PATCH the rail uses.
 */
export function CardMenu({
  conversationId,
  title,
  currentFolderId,
  folders,
  shared = false,
  hasActiveLink = false,
}: {
  conversationId: string;
  title: string;
  currentFolderId: string | null;
  folders: CardFolder[];
  /** Whether this conversation is currently shared with the trusted person. */
  shared?: boolean;
  /** Whether a share/stop-share action should appear in the menu at all. */
  hasActiveLink?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingHide, setConfirmingHide] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // When the confirm takes over the card, land focus on "Keep it" (the safe
  // action) so a keyboard user never fires "Hide it" by reflex.
  const keepItRef = useConfirmFocus<HTMLButtonElement>(confirmingHide);

  // Dismissing the confirm (Keep it / Escape) unmounts the whole confirm card;
  // hand focus back to the actions trigger it opened from so it never drops to
  // <body> and a keyboard user stays where they were.
  function dismissConfirm() {
    setConfirmingHide(false);
    focusAfterDestructive(triggerRef);
  }

  // Escape dismisses the open menu whether it was reached by touch or keyboard.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function patch(
    body: { title: string } | { folderId: string | null } | { hidden: boolean },
  ): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(res.status === 429 ? GENTLE_PACE : "Couldn't save — try again.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      // Offline / network failure — surfaced like a non-OK response so the
      // action never dies silently.
      setError("Couldn't save — try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startRename() {
    setOpen(false);
    setError(null);
    setDraft(title);
    setRenaming(true);
  }

  async function submitRename(e: React.SubmitEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (!next || busy) return;
    if (next === title) {
      setRenaming(false);
      return;
    }
    const ok = await patch({ title: next });
    if (ok) setRenaming(false);
  }

  async function move(folderId: string | null) {
    setOpen(false);
    await patch({ folderId });
  }

  function startHide() {
    setOpen(false);
    setError(null);
    setConfirmingHide(true);
  }

  async function hide() {
    // patch refreshes on success, unmounting this menu with the card; on failure
    // it drops back onto the confirm with the error shown beneath it.
    await patch({ hidden: true });
  }

  async function toggleShare() {
    setOpen(false);
    setError(null);
    setBusy(true);
    const ok = shared
      ? await stopSharingConversation(conversationId)
      : await shareConversation(conversationId);
    setBusy(false);
    if (ok) router.refresh();
    else setError("Couldn't update sharing — try again.");
  }

  if (renaming) {
    return (
      <form
        onSubmit={submitRename}
        className="absolute inset-0 z-40 flex flex-col justify-center gap-1.5 rounded-[18px] border border-accent/40 bg-card p-[18px] shadow-sm"
      >
        <input
          autoFocus
          aria-label="Rename conversation"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (!busy) setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setRenaming(false);
            }
          }}
          disabled={busy}
          maxLength={200}
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-[0.9rem] font-semibold tracking-[-0.005em] outline-none transition-[border-color] duration-150 focus-visible:border-accent disabled:opacity-60"
        />
        {error ? (
          <span role="alert" className="font-serif text-[11.5px] italic text-accent">
            {error}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/80">Enter to save · Esc to cancel</span>
        )}
      </form>
    );
  }

  if (confirmingHide) {
    return (
      <div
        role="dialog"
        aria-label="Hide conversation?"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            dismissConfirm();
          }
        }}
        className="absolute inset-0 z-40 flex flex-col justify-center gap-3 rounded-[18px] border border-accent/40 bg-card p-[18px] shadow-sm"
      >
        <p className="text-pretty font-serif text-[0.9rem] italic leading-relaxed text-muted-foreground">
          This hides it from your view. If it&apos;s shared, your trusted person
          can still see it. You can restore it any time.
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={hide}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.97] disabled:opacity-50"
          >
            {busy ? "Hiding…" : "Hide it"}
          </button>
          <button
            ref={keepItRef}
            type="button"
            onClick={dismissConfirm}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            Keep it
          </button>
        </div>
        {error ? (
          <span role="alert" className="font-serif text-[11.5px] italic text-accent">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Conversation actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={(e) => {
          // The trigger sits over a link — keep the click from doing anything
          // but toggle the menu.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`absolute right-2 top-2 z-30 flex size-8 items-center justify-center rounded-md text-muted-foreground opacity-70 outline-none transition-[opacity,color] duration-150 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100 ${
          open ? "opacity-100 md:opacity-100" : ""
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <circle cx="3.2" cy="8" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="12.8" cy="8" r="1.3" />
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
            }}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="animate-cp-pop absolute right-2 top-11 z-50 min-w-40 overflow-hidden rounded-xl border bg-card p-1 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_28px_-10px_rgba(0,0,0,0.25)]"
          >
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
                onClick={toggleShare}
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
                onClick={() => move(f.id)}
                className="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {f.name}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              disabled={currentFolderId === null}
              onClick={() => move(null)}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Unsorted
            </button>
            <div role="separator" className="mx-1 my-1 h-px bg-border/60" />
            <button
              type="button"
              role="menuitem"
              onClick={startHide}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05]"
            >
              Hide
            </button>
          </div>
        </>
      )}

      {error && !open ? (
        // No interactive children — pointer-events-none keeps it from
        // intercepting clicks meant for the card link underneath.
        <p
          role="alert"
          className="pointer-events-none absolute inset-x-2 bottom-2 z-30 rounded-md bg-card/95 px-2 py-1 font-serif text-[11px] italic text-accent shadow-sm"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
