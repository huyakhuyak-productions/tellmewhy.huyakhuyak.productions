/**
 * The core of a minimal, hand-rolled focus trap: given a dialog's focusable
 * elements, the currently-focused one, and whether Shift was held on Tab,
 * return the element focus should wrap to — or `null` when focus is mid-list
 * and the browser's native Tab handling should proceed untouched.
 *
 * Kept pure (no DOM access) so the wrap logic is unit-testable in a Node
 * environment; the component layer supplies the live element list.
 */
export function wrapFocus<T>(focusables: T[], active: T | null, shiftKey: boolean): T | null {
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const inside = active !== null && focusables.includes(active);

  if (shiftKey) {
    // Shift+Tab off the first element (or from outside the trap) wraps to the last.
    if (!inside || active === first) return last;
    return null;
  }
  // Tab off the last element (or from outside the trap) wraps to the first.
  if (!inside || active === last) return first;
  return null;
}
