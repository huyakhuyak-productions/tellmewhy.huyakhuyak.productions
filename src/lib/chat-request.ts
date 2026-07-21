// The ai-sdk transport hands us a `trigger` + optional `messageId`; the server
// (POST /api/chat, Task 3) speaks one of two shapes:
//   { conversationId, text, parentId?: uuid | null }  ⇒ a send or an edit/branch
//   { conversationId, regenerateOf: uuid }            ⇒ re-run an AI reply
// This pure mapper turns the SDK's request shape into that wire body so the
// component's transport stays a thin call and the branching logic is testable
// without a DOM or a live chat.
export type ChatTrigger = "submit-message" | "regenerate-message";

export function buildChatRequestBody(input: {
  conversationId: string;
  trigger: ChatTrigger;
  messageId: string | undefined;
  /** The last user message's text — "" for a regenerate (no new user turn). */
  text: string;
  /** Meta lookup: the edited message's parent id (null at root, undefined if unknown). */
  parentIdOf: (messageId: string) => string | null | undefined;
}): Record<string, unknown> {
  if (input.trigger === "regenerate-message") {
    // A regenerate names the reply it re-runs. Without a messageId there is no
    // target, so there is no honest body to build — throwing surfaces the
    // programmer error at the mapper rather than emitting { text: "" } and
    // letting the server's min(1) text guard answer an opaque 400. The one
    // call site (chat-screen's regenerateMessage) always passes the reply's id.
    if (!input.messageId) throw new Error("Cannot regenerate a reply without its message id");
    return { conversationId: input.conversationId, regenerateOf: input.messageId };
  }
  if (input.messageId !== undefined) {
    // An edit: the replacement message reuses the edited message's parent so
    // the server branches from the same point. A known root parent is null (an
    // explicit "branch at the root"); an unknown message contributes no key so
    // the server falls back to appending onto the active leaf.
    const parentId = input.parentIdOf(input.messageId);
    return {
      conversationId: input.conversationId,
      text: input.text,
      ...(parentId !== undefined ? { parentId } : {}),
    };
  }
  return { conversationId: input.conversationId, text: input.text };
}
