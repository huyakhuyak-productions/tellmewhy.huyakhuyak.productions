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
  // A caller-minted primary key (the client's per-send idempotency key). When
  // set, a re-send that carries the same id resolves to the row already stored
  // rather than inserting a duplicate — an at-least-once POST persists exactly
  // once. Omitted for server-authored rows (AI reply, therapist), which have no
  // retry to dedupe and let the DB mint the id.
  id?: string;
  // `reused` is true only on an idempotent conflict-reuse (a replay of a
  // caller-minted id); `riskLevel` is the STORED row's level — the original on a
  // reuse, the just-inserted one otherwise. It lets the route prefer the stored
  // risk over a replay's fresh classification (never downgrade a crisis turn).
}): Promise<{ id: string; reused: boolean; riskLevel: RiskLevel }> {
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

    // With a caller-minted id, ignore the conflict on the primary key so a
    // duplicate send inserts nothing and returns no row; without one, the DB
    // mints the id and the insert always yields a row.
    const insert = tx
      .insert(messages)
      .values({
        ...(input.id !== undefined ? { id: input.id } : {}),
        conversationId: input.conversationId,
        parentId,
        sender: input.sender,
        ciphertext: encryptText(dek, input.text),
        riskLevel: input.riskLevel ?? "none",
      });
    const [row] =
      input.id !== undefined
        ? await insert.onConflictDoNothing({ target: messages.id }).returning({ id: messages.id })
        : await insert.returning({ id: messages.id });

    if (!row) {
      // The id already exists (only reachable when a caller-minted id conflicts).
      // Reuse it ONLY when the stored row is genuinely this same send: same
      // conversation AND same sender. A conflict against a foreign conversation's
      // row, another user's row, or an AI/therapist row is a replay of an id this
      // send has no claim to — answer the uniform 404, never chain onto it. The
      // conversation ownership was already established above, so a same-conversation
      // client row here belongs to this owner. Reuse takes no leaf move: the first
      // send already positioned the leaf, and a fresh reply will move it onward.
      //
      // The stored row is the authority: its text and risk are NOT overwritten by
      // this replay's payload. Returning the stored `riskLevel` lets the route
      // keep a crisis flag even if a replay carrying different words (or a flaky
      // classifier) would have scored the turn lower — the same "never silently
      // downgrade a crisis turn" invariant the regenerate path upholds.
      const [existing] = await tx
        .select({ id: messages.id, conversationId: messages.conversationId, sender: messages.sender, riskLevel: messages.riskLevel })
        .from(messages)
        .where(eq(messages.id, input.id!));
      if (!existing || existing.conversationId !== input.conversationId || existing.sender !== input.sender) {
        throw new NotFoundError("Message not found");
      }
      return { id: existing.id, reused: true, riskLevel: existing.riskLevel };
    }

    await tx
      .update(conversations)
      .set({ activeLeafId: row.id, updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));
    return { id: row.id, reused: false, riskLevel: input.riskLevel ?? "none" };
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

// A raw row's plaintext columns — never any ciphertext. Path resolution and
// regenerate-target validation run over THESE, so a body that fails to decrypt
// (and is therefore absent from the decrypted `messages` list) can neither
// sever the chain above it nor make an AI reply unregenerable. Shaped as a
// superset of message-tree's TreeNode, so the tree helpers consume it directly.
export type MessageNode = { id: string; parentId: string | null; createdAt: Date; sender: Sender };

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
// reader both build on. `riskById` carries every message's stored risk level
// off its RAW row (a plaintext column): it survives ciphertext corruption that
// would drop a body from `messages`, so a safety decision keyed on a message's
// risk can never be silently downgraded because that message failed to decrypt.
export async function loadMessageTree(
  conversationId: string,
  userId: string,
): Promise<{
  messages: LoadedMessage[];
  nodes: MessageNode[];
  riskById: Map<string, RiskLevel>;
  activeLeafId: string | null;
}> {
  const conversation = await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  return {
    messages: rows.flatMap((r) => decryptMessageRow(dek, r)),
    // Every row's plaintext columns, corrupt bodies included — the raw material
    // callers resolve the active path (and validate a regenerate target) over.
    nodes: rows.map((r) => ({ id: r.id, parentId: r.parentId, createdAt: r.createdAt, sender: r.sender })),
    riskById: new Map(rows.map((r) => [r.id, r.riskLevel])),
    activeLeafId: conversation.activeLeafId,
  };
}

// The client's current view: the active leaf's root-to-leaf chain. Existing
// callers that treated this as "the whole conversation" stay correct — a
// linear conversation's active path IS its full chronological history.
export async function loadMessages(conversationId: string, userId: string): Promise<LoadedMessage[]> {
  const conversation = await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  // Resolve the active path over RAW rows first — id/parentId/createdAt need
  // no decryption — so an undecryptable row mid-chain can't sever the ancestors
  // above it. Only the path's own rows are then decrypted; a corrupt node is
  // skipped (and logged) by decryptMessageRow, leaving its ancestors intact.
  const path = resolveActivePath(
    rows.map((r) => ({ id: r.id, parentId: r.parentId, createdAt: r.createdAt })),
    conversation.activeLeafId,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return path.flatMap((id) => {
    const r = byId.get(id);
    return r ? decryptMessageRow(dek, r) : [];
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
