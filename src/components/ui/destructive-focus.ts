"use client";

import { useEffect, useRef, type RefObject } from "react";

// The two halves of the delete/keep focus idiom, shared by every place that
// guards a destructive action behind a two-step confirm (the rail's Hide, a
// card's Hide, a note's "let it go") or hands focus off after one resolves (an
// assignment's Close). Kept tiny — two functions, no component — so the copy
// and markup stay each caller's own; only the focus mechanics are shared.

// Confirm-OPEN half: when a destructive confirm takes over, land focus on the
// SAFE option (Keep it / Cancel) so a keyboard user never fires the destructive
// action by reflex. Returns the ref to attach to that safe control.
export function useConfirmFocus<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const safeRef = useRef<T | null>(null);
  useEffect(() => {
    if (active) safeRef.current?.focus();
  }, [active]);
  return safeRef;
}

// Resolve/DISMISS half: the control that had focus is about to unmount (a
// confirmed delete removes the row; a dismissed confirm swaps back to the menu),
// so hand focus to a stable target on the NEXT frame — after React commits the
// new node — instead of letting it drop to <body> where a screen reader hears
// nothing. A move-not-trap, matching message-keep / exercises-screen.
export function focusAfterDestructive(target: RefObject<HTMLElement | null>): void {
  requestAnimationFrame(() => target.current?.focus());
}
