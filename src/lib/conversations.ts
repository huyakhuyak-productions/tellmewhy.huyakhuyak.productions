import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { errorCause, NotFoundError } from "./errors";
import { deepestDescendant, resolveActivePath } from "./message-tree";

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
    // "Delete" in the UI only hides a conversation from the client's own list —
    // the row lives on for therapist surfaces and is excluded here alone.
    .where(and(eq(conversations.userId, userId), isNull(conversations.hiddenAt)))
    .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt));
  // A single corrupted row (bit rot, a bad migration, manual tampering) must
  // never take the rest of the list down with it — skip and log just the row
  // id (never ciphertext or decrypted text) and keep serving the healthy rows.
  return rows.flatMap((r) => {
    try {
      return [{ id: r.id, title: decryptText(dek, r.titleCiphertext), updatedAt: r.updatedAt, folderId: r.folderId }];
    } catch (error) {
      console.error(`Failed to decrypt conversation ${r.id} (${errorCause(error)})`);
      return [];
    }
  });
}

// The "recently deleted" view: the client's hidden conversations, newest-hidden
// first, each carrying its hiddenAt so the UI can offer a restore.
export async function listHiddenConversations(userId: string) {
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, userId), isNotNull(conversations.hiddenAt)))
    .orderBy(desc(conversations.hiddenAt));
  return rows.flatMap((r) => {
    try {
      return [
        {
          id: r.id,
          title: decryptText(dek, r.titleCiphertext),
          updatedAt: r.updatedAt,
          folderId: r.folderId,
          hiddenAt: r.hiddenAt!,
        },
      ];
    } catch (error) {
      console.error(`Failed to decrypt conversation ${r.id} (${errorCause(error)})`);
      return [];
    }
  });
}

// Hide (soft-delete) or restore a conversation from the client's own list.
export async function setConversationHidden(conversationId: string, userId: string, hidden: boolean): Promise<void> {
  await requireOwnedConversation(conversationId, userId);
  await db
    .update(conversations)
    .set({ hiddenAt: hidden ? new Date() : null })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
}

export async function saveMessage(input: {
  conversationId: string;
  userId: string;
  sender: Sender;
  text: string;
  riskLevel?: RiskLevel;
  // undefined = append to the conversation's current leaf; an explicit uuid or
  // null branches there instead (null = a brand-new root).
  parentId?: string | null;
}): Promise<{ id: string }> {
  await requireOwnedConversation(input.conversationId, input.userId);
  const dek = await getOrCreateUserDek(input.userId);
  // The insert, the leaf move, and the updatedAt bump must succeed or fail
  // together — a reply persisted without moving the leaf (or bumping the
  // conversation's ordering) would silently corrupt the client's active path
  // or the sidebar's "most recent" sort.
  return db.transaction(async (tx) => {
    let parentId: string | null;
    if (input.parentId === undefined) {
      // Append: read the active leaf under a row lock (SELECT … FOR UPDATE) so
      // concurrent appends serialize per conversation — the second waits for
      // the first to commit and chains off the freshly-moved leaf, instead of
      // both reading the same leaf and inserting accidental siblings.
      const [conv] = await tx
        .select({ activeLeafId: conversations.activeLeafId })
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .for("update");
      if (!conv) throw new NotFoundError("Conversation not found");
      parentId = conv.activeLeafId;
    } else {
      parentId = input.parentId;
      // A branch point must be a real message of THIS conversation; a foreign
      // or missing parent is indistinguishable from "not found" to the client.
      if (parentId !== null) {
        const [parent] = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.id, parentId), eq(messages.conversationId, input.conversationId)));
        if (!parent) throw new NotFoundError("Parent message not found");
      }
    }

    const [row] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        parentId,
        sender: input.sender,
        ciphertext: encryptText(dek, input.text),
        riskLevel: input.riskLevel ?? "none",
      })
      .returning({ id: messages.id });
    await tx
      .update(conversations)
      .set({ activeLeafId: row.id, updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));
    return row;
  });
}

type LoadedMessage = {
  id: string;
  sender: Sender;
  text: string;
  riskLevel: RiskLevel;
  authorId: string | null;
  flaggedAt: Date | null;
  parentId: string | null;
  createdAt: Date;
};

function decryptMessageRow(
  dek: Awaited<ReturnType<typeof getOrCreateUserDek>>,
  r: typeof messages.$inferSelect,
): LoadedMessage[] {
  // Same corrupt-row isolation as listConversations: skip and log the row id
  // only, never abort the whole conversation over one bad row.
  try {
    return [
      {
        id: r.id,
        sender: r.sender,
        text: decryptText(dek, r.ciphertext),
        riskLevel: r.riskLevel,
        authorId: r.authorId,
        flaggedAt: r.flaggedAt,
        parentId: r.parentId,
        createdAt: r.createdAt,
      },
    ];
  } catch (error) {
    console.error(`Failed to decrypt message ${r.id} (${errorCause(error)})`);
    return [];
  }
}

// Every message of a conversation, flat, in (createdAt, id) order, plus the
// active leaf — the raw material the version switcher and the active-path
// reader both build on.
export async function loadMessageTree(
  conversationId: string,
  userId: string,
): Promise<{ messages: LoadedMessage[]; activeLeafId: string | null }> {
  const conversation = await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  return { messages: rows.flatMap((r) => decryptMessageRow(dek, r)), activeLeafId: conversation.activeLeafId };
}

// The client's current view: the active leaf's root-to-leaf chain. Existing
// callers that treated this as "the whole conversation" stay correct — a
// linear conversation's active path IS its full chronological history.
export async function loadMessages(conversationId: string, userId: string): Promise<LoadedMessage[]> {
  const { messages: all, activeLeafId } = await loadMessageTree(conversationId, userId);
  const path = resolveActivePath(all, activeLeafId);
  const byId = new Map(all.map((m) => [m.id, m]));
  return path.flatMap((id) => {
    const m = byId.get(id);
    return m ? [m] : [];
  });
}

// Point the conversation's active path at a chosen message. Switching to an
// interior node lands on that subtree's deepest-latest leaf, so the client
// sees the full continuation of the version they picked, not a truncated stub.
export async function setActiveLeaf(conversationId: string, userId: string, messageId: string): Promise<void> {
  await requireOwnedConversation(conversationId, userId);
  await db.transaction(async (tx) => {
    // Lock the conversation row (SELECT … FOR UPDATE) so this leaf move
    // serializes against concurrent appends — which lock it the same way —
    // instead of the switch and an append clobbering each other's activeLeafId.
    const [conv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (!conv) throw new NotFoundError("Conversation not found");
    const rows = await tx
      .select({ id: messages.id, parentId: messages.parentId, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, conversationId));
    if (!rows.some((r) => r.id === messageId)) throw new NotFoundError("Message not found");
    await tx
      .update(conversations)
      .set({ activeLeafId: deepestDescendant(rows, messageId) })
      .where(eq(conversations.id, conversationId));
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
