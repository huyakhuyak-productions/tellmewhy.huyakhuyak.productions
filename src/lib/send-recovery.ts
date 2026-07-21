import type { UIMessage } from "ai";

// Narrow the UI-message parts down to their text safely (the SDK's part union
// isn't narrowed by a bare `.filter`, so a map keeps TypeScript honest).
export function partsToText(parts: UIMessage["parts"]): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

// After a failed send, ai v6 leaves the attempted user message (and possibly a
// partial assistant reply, if the stream died mid-way) at the tail of the
// local thread. Pull the failed words out and drop the failed tail, so the
// text can move back into the composer without ever being duplicated when the
// writer retries (sendMessage always appends a fresh user message).
export function harvestFailedSend<M extends UIMessage>(
  messages: M[],
): { failedText: string; messagesWithoutFailure: M[] } | null {
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  if (lastUserIndex === -1) return null;
  const failedText = partsToText(messages[lastUserIndex].parts);
  if (!failedText.trim()) return null;
  return { failedText, messagesWithoutFailure: messages.slice(0, lastUserIndex) };
}

// The idempotency key for a resend from the composer. An untouched retry — the
// composer still holds exactly the words that failed — reuses the failed
// attempt's key so the server dedupes it onto the one already-persisted client
// row; any edit, or a send with no failure stashed, mints a fresh key that
// persists as its own turn. Trim-compared on purpose: the failure restore
// re-inserts the failed words verbatim, so the writer either resends them as-is
// (reuse) or genuinely changes them (fresh) — surrounding whitespace alone is
// not a meaningful edit. Same crypto.randomUUID() the wire body's clientMessageId
// requires (a uuid — never the AI-SDK UIMessage id, which is the wrong format).
export function resendMessageId(failed: { id: string; text: string } | null, draft: string): string {
  if (failed && failed.text.trim() === draft.trim()) return failed.id;
  return crypto.randomUUID();
}

// Merge a failed message back into the composer without clobbering anything
// the writer typed while the send was in flight. The failed words go first —
// they are chronologically older — separated by a blank line.
export function mergeRestoredDraft(failedText: string, currentDraft: string): string {
  if (!currentDraft.trim()) return failedText;
  if (currentDraft.trim() === failedText.trim()) return currentDraft;
  return `${failedText}\n\n${currentDraft}`;
}
