"use client";

import { useEffect, useRef, useState } from "react";
import { composeSubmitTitle, isComposeSubmit } from "@/lib/keyboard";
import { useIsMac } from "@/lib/use-is-mac";

const EDIT_MAX = 8000;

// The inline edit composer: a person's own message swapped for an editable box.
// Saving rewrites that message and branches a fresh reply from it; cancelling
// leaves the words untouched. Styled to echo the main composer's calm card so
// the swap reads as the same surface, not a modal interruption. ⌘↵ / Ctrl+↵
// saves (a bare Enter stays a newline — a long reflection often has them), and
// Save is held while a send is already in flight so an edit can't race a stream.
export function MessageEdit({
  initialText,
  onSave,
  onCancel,
  isBusy,
}: {
  initialText: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  /** A send/stream is already in flight — Save stays held until it settles. */
  isBusy: boolean;
}) {
  const isMac = useIsMac();
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Land focus in the box with the caret at the end so the writer can keep
  // typing where they left off, and size the box to the words already there.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const canSave = text.trim().length > 0 && !isBusy;

  function save() {
    if (!canSave) return;
    onSave(text.trim());
  }

  return (
    <div className="animate-message-rise ml-auto flex w-full max-w-[88%] flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 320)}px`;
        }}
        onKeyDown={(e) => {
          if (isComposeSubmit(e)) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        maxLength={EDIT_MAX}
        rows={2}
        aria-label="Edit your message"
        className="max-h-80 min-h-11 w-full resize-none rounded-2xl border bg-card px-4 py-2.5 text-[0.975rem] leading-relaxed shadow-sm outline-none transition-[box-shadow,border-color] duration-150 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[0.8rem] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          title={composeSubmitTitle("save", isMac)}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-[0.8rem] font-medium text-accent-foreground outline-none transition-[background-color,transform,opacity] duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
