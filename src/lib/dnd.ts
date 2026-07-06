import { useState, useSyncExternalStore } from "react";

/**
 * Native HTML5 drag-and-drop for filing conversations into folders — a desktop
 * enhancement layered over the card/rail menus, never their replacement.
 *
 * The payload is the conversation id and nothing else: never a title or any
 * decrypted content, so a stray drop onto another app leaks nothing meaningful.
 * A private mime type lets drop targets accept our drags while ignoring files,
 * text selections, or links dragged in from elsewhere.
 */
export const CONVERSATION_DND_MIME = "application/x-tellmewhy-conversation";

export function setConversationDragData(dt: DataTransfer, conversationId: string) {
  dt.setData(CONVERSATION_DND_MIME, conversationId);
  // text/plain fallback: some engines (and Playwright's synthetic DnD) only
  // reliably carry the standard type across the dragstart→drop boundary.
  dt.setData("text/plain", conversationId);
  dt.effectAllowed = "move";
}

export function hasConversationDragData(dt: DataTransfer): boolean {
  return dt.types.includes(CONVERSATION_DND_MIME);
}

export function getConversationDragId(dt: DataTransfer): string {
  return dt.getData(CONVERSATION_DND_MIME) || dt.getData("text/plain");
}

/**
 * A drop target that warms up (via `over`) while a conversation hovers it and
 * files the conversation on drop. Ignores every drag that isn't one of ours so
 * files or selected text never trigger a phantom highlight.
 */
export function useConversationDropTarget(onDropConversation: (conversationId: string) => void) {
  const [over, setOver] = useState(false);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasConversationDragData(e.dataTransfer)) return;
      // preventDefault is what marks this element as a valid drop zone.
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      if (!hasConversationDragData(e.dataTransfer)) return;
      e.preventDefault();
      setOver(false);
      const id = getConversationDragId(e.dataTransfer);
      if (id) onDropConversation(id);
    },
  };

  return { over, dropProps };
}

const DRAG_POINTER_QUERY = "(min-width: 1024px) and (pointer: fine)";

/**
 * True only on a large viewport driven by a precise pointer — the one context
 * where drag-and-drop is a real affordance. Phones and tablets keep the menu
 * path untouched. The server snapshot is false, so server and first client
 * render agree; it settles to the real value after hydration.
 */
export function useDragPointer(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia(DRAG_POINTER_QUERY);
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(DRAG_POINTER_QUERY).matches,
    () => false,
  );
}
