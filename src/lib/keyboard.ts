// The "compose submit" shortcut for multiline textareas that carry an explicit
// save/send button: ⌘↵ on macOS, Ctrl+↵ elsewhere. A plain Enter always stays
// a newline in these boxes (the button is the only quiet, deliberate commit),
// so the modifier is what promotes typing to saving — mirroring the muscle
// memory of every chat and mail composer. Shift+Enter and every other key are
// left untouched.
//
// A structural shape (not React's SyntheticEvent) so the predicate stays pure
// and unit-testable without a DOM: any object carrying the four fields a key
// event exposes will do.
export type ComposeKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

export function isComposeSubmit(event: ComposeKeyEvent): boolean {
  if (event.key !== "Enter") return false;
  // Shift+Enter is the newline gesture — never a submit, even alongside a
  // modifier (a stray Shift must not swallow the shortcut's intent either way,
  // so it simply defers to the newline).
  if (event.shiftKey) return false;
  return event.metaKey || event.ctrlKey;
}
