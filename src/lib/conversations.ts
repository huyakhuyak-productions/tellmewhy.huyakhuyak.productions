import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";

// Re-exported for compatibility — existing callers importing NotFoundError
// from here keep working; new code should import it from "./errors" directly.
export { NotFoundError };

type Sender = "client" | "ai" | "therapist" | "system";
type RiskLevel = "none" | "elevated" | "crisis";

async function requireOwnedConversation(conversationId: string, userId: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!row) throw new NotFoundError("Conversation not found");
  return row;
}

export async function createConversation(userId: string, title: string): Promise<{ id: string }> {
  const dek = await getOrCreateUserDek(userId);
  const [row] = await db
    .insert(conversations)
    .values({ userId, titleCiphertext: encryptText(dek, title) })
    .returning({ id: conversations.id });
  return row;
}

export async function listConversations(userId: string) {
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt));
  // A single corrupted row (bit rot, a bad migration, manual tampering) must
  // never take the rest of the list down with it — skip and log just the row
  // id (never ciphertext or decrypted text) and keep serving the healthy rows.
  return rows.flatMap((r) => {
    try {
      return [{ id: r.id, title: decryptText(dek, r.titleCiphertext), updatedAt: r.updatedAt, folderId: r.folderId }];
    } catch (error) {
      console.error(`Failed to decrypt conversation ${r.id}`, error);
      return [];
    }
  });
}

export async function saveMessage(input: {
  conversationId: string;
  userId: string;
  sender: Sender;
  text: string;
  riskLevel?: RiskLevel;
}): Promise<{ id: string }> {
  await requireOwnedConversation(input.conversationId, input.userId);
  const dek = await getOrCreateUserDek(input.userId);
  // The insert and the updatedAt bump must succeed or fail together — a
  // reply persisted without bumping the conversation's ordering (or vice
  // versa) would silently corrupt the sidebar's "most recent" sort.
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        sender: input.sender,
        ciphertext: encryptText(dek, input.text),
        riskLevel: input.riskLevel ?? "none",
      })
      .returning({ id: messages.id });
    await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
    return row;
  });
}

export async function loadMessages(conversationId: string, userId: string) {
  await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  // Same corrupt-row isolation as listConversations: skip and log the row id
  // only, never abort the whole conversation over one bad row.
  return rows.flatMap((r) => {
    try {
      return [
        {
          id: r.id,
          sender: r.sender,
          text: decryptText(dek, r.ciphertext),
          riskLevel: r.riskLevel,
          createdAt: r.createdAt,
        },
      ];
    } catch (error) {
      console.error(`Failed to decrypt message ${r.id}`, error);
      return [];
    }
  });
}

export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string,
  opts?: { customized?: boolean },
): Promise<void> {
  await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  // The route's pre-check (isTitleCustomized before the up-to-5s generateText
  // call) is only a fast path, not the guarantee: a human rename can land in
  // that window. For the auto path, the WHERE clause itself must refuse any
  // row a human has already claimed, so the check-then-write race can't
  // silently overwrite (or un-claim) a human-picked title.
  const whereClause =
    opts?.customized === false
      ? and(eq(conversations.id, conversationId), eq(conversations.userId, userId), eq(conversations.titleCustomized, false))
      : and(eq(conversations.id, conversationId), eq(conversations.userId, userId));
  await db
    .update(conversations)
    .set({ titleCiphertext: encryptText(dek, title), titleCustomized: opts?.customized ?? true })
    .where(whereClause);
}

export async function isTitleCustomized(conversationId: string, userId: string): Promise<boolean> {
  const row = await requireOwnedConversation(conversationId, userId);
  return row.titleCustomized;
}

// "Flag for my therapist" — ownership-checked via the message's own
// conversation, same as every other client-facing message operation. No
// therapist grant is required: the flag waits until the client actually
// shares the conversation, at which point it surfaces in the attention
// queue. Idempotent: flagging an already-flagged message is a no-op that
// keeps the original timestamp, not a fresh "now".
export async function flagMessageForTherapist(userId: string, messageId: string): Promise<void> {
  const [row] = await db
    .select({ id: messages.id, flaggedAt: messages.flaggedAt })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(messages.id, messageId), eq(conversations.userId, userId)));
  if (!row) throw new NotFoundError("Message not found");
  if (row.flaggedAt) return;

  await db.update(messages).set({ flaggedAt: new Date() }).where(eq(messages.id, messageId));
}
