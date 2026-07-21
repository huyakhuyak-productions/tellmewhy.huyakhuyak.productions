// The "compose submit" shortcut for multiline textareas that carry an explicit
// save/send button: ⌘↵ on macOS, Ctrl+↵ elsewhere. A plain Enter always stays
// a newline in these boxes (the button is the only quiet, deliberate commit),
// so the modifier is what promotes typing to saving — mirroring the muscle
// memory of every chat and mail composer. Shift+Enter and every other key are
// left untouched.
//
// A structural shape (not React's SyntheticEvent) so the predicate stays pure
// and unit-testable without a DOM: any object carrying the key-event fields it
// reads will do. `isComposing` lives on the NATIVE KeyboardEvent (not React's
// synthetic one), so callers pass `e.nativeEvent`.
export type ComposeKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
};

export function isComposeSubmit(event: ComposeKeyEvent): boolean {
  if (event.key !== "Enter") return false;
  // An Enter fired while an IME is mid-composition confirms the candidate the
  // person is typing — it must never submit and swallow their unfinished word.
  if (event.isComposing) return false;
  // Shift+Enter is the newline gesture, and Alt+Enter is an OS/editor shortcut
  // — neither is a submit, even alongside a submit modifier, so they defer.
  if (event.shiftKey || event.altKey) return false;
  return event.metaKey || event.ctrlKey;
}

// The visible name of the shortcut, matched to the keyboard in front of the
// person — ⌘ means nothing on a PC and Ctrl reads wrong on a Mac.
export function composeSubmitTitle(verb: string, isMac: boolean): string {
  return `${isMac ? "⌘↵" : "Ctrl+↵"} to ${verb}`;
}
