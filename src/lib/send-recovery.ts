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

// Merge a failed message back into the composer without clobbering anything
// the writer typed while the send was in flight. The failed words go first —
// they are chronologically older — separated by a blank line.
export function mergeRestoredDraft(failedText: string, currentDraft: string): string {
  if (!currentDraft.trim()) return failedText;
  if (currentDraft.trim() === failedText.trim()) return currentDraft;
  return `${failedText}\n\n${currentDraft}`;
}
