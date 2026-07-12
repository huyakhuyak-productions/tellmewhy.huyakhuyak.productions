import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, selfNotes } from "@/db/schema";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { errorCause, NotFoundError, ValidationError } from "./errors";

export const MAX_NOTE_BODY_LENGTH = 2000;

export type SelfNote = {
  id: string;
  body: string;
  sourceMessageId: string | null;
  createdAt: Date;
};

// A note is the owner's alone: encrypted under their DEK, no share column,
// no therapist route anywhere in this module. Both creation paths produce
// the same shape — provenance is the only difference.
export async function createNote(
  userId: string,
  input: { body: string } | { messageId: string },
): Promise<{ id: string }> {
  let body: string;
  let sourceMessageId: string | null = null;

  if ("messageId" in input) {
    // Keep-from-chat: the message must live in a conversation the caller
    // owns — anyone else's message is indistinguishable from a nonexistent
    // one. The body decrypts under the caller's own DEK (the conversation
    // owner's), so a foreign row would fail structurally even without the
    // ownership predicate.
    const [row] = await db
      .select({ ciphertext: messages.ciphertext })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(messages.id, input.messageId), eq(conversations.userId, userId)));
    if (!row) throw new NotFoundError("Message not found");
    const dek = await getOrCreateUserDek(userId);
    body = decryptText(dek, row.ciphertext);
    sourceMessageId = input.messageId;
  } else {
    body = input.body.trim();
    if (body.length === 0) throw new ValidationError("A note needs a few words");
    if (body.length > MAX_NOTE_BODY_LENGTH) {
      throw new ValidationError(`A note must be ${MAX_NOTE_BODY_LENGTH} characters or fewer`);
    }
  }

  const dek = await getOrCreateUserDek(userId);
  const bodyCiphertext = encryptText(dek, body);
  const [created] = await db
    .insert(selfNotes)
    .values({ userId, bodyCiphertext, sourceMessageId })
    .returning({ id: selfNotes.id });
  return { id: created.id };
}

export async function listNotes(userId: string): Promise<SelfNote[]> {
  const rows = await db
    .select()
    .from(selfNotes)
    .where(eq(selfNotes.userId, userId))
    .orderBy(desc(selfNotes.createdAt));
  const dek = await getOrCreateUserDek(userId);
  return rows.flatMap((r) => {
    try {
      return [
        {
          id: r.id,
          body: decryptText(dek, r.bodyCiphertext),
          sourceMessageId: r.sourceMessageId,
          createdAt: r.createdAt,
        },
      ];
    } catch (error) {
      // Ids + cause only — never ciphertext, never a raw error object.
      console.error(`Failed to decrypt note ${r.id} (${errorCause(error)})`);
      return [];
    }
  });
}

export async function deleteNote(userId: string, noteId: string): Promise<void> {
  const deleted = await db
    .delete(selfNotes)
    .where(and(eq(selfNotes.id, noteId), eq(selfNotes.userId, userId)))
    .returning({ id: selfNotes.id });
  if (deleted.length === 0) throw new NotFoundError("Note not found");
}
