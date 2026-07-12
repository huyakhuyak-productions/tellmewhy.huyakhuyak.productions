// THE gate. Every therapist-facing read/write of client data must flow
// through `requireGrantedConversation` — no route or module may reach client
// data another way. Ungranted, revoked, or foreign access is indistinguishable
// from nonexistence: NotFoundError, never a more specific error, never a
// title or body in the message.
//
// PERMANENT EXCEPTION: author-owned data addressed by linkId/therapistId +
// clientId (therapist notes, instruction reads) is exempt from this gate;
// anything serving CLIENT data to a therapist is not. Do not route
// note-listing through the gate — that would break the
// publish-survives-revocation guarantee (see listPublicNotesForClient /
// listNotesForTherapist in therapist-notes.ts).
import { and, count, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, sharingGrants, therapistLinks } from "@/db/schema";
import { recordAudit } from "./audit";
import { decryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { errorCause, NotFoundError, ValidationError } from "./errors";

const NO_ACTIVE_LINK_MESSAGE = "No active therapist link";

export type GrantedConversationSummary = {
  id: string;
  title: string;
  updatedAt: Date;
  lastMessageAt: Date | null;
  messageCount: number;
  flaggedCount: number;
  crisisCount: number;
};

// THE gate: a live grant joined to an `active` link whose therapistId
// matches the caller. Anything else — no grant, a revoked link, a grant that
// somehow survives under a revoked link, a foreign therapist, nonexistent
// ids — must fail the same way: NotFoundError, no hint of what actually went
// wrong.
export async function requireGrantedConversation(
  therapistId: string,
  conversationId: string,
): Promise<{ linkId: string; clientId: string }> {
  const [row] = await db
    .select({ linkId: therapistLinks.id, clientId: therapistLinks.clientId })
    .from(sharingGrants)
    .innerJoin(therapistLinks, eq(sharingGrants.linkId, therapistLinks.id))
    .innerJoin(conversations, eq(sharingGrants.conversationId, conversations.id))
    .where(
      and(
        eq(sharingGrants.conversationId, conversationId),
        eq(therapistLinks.status, "active"),
        eq(therapistLinks.therapistId, therapistId),
        // Defense-in-depth: the gate independently re-verifies the conversation
        // belongs to the link's client, so a corrupted grant row cannot leak
        // across clients.
        eq(conversations.userId, therapistLinks.clientId),
      ),
    );
  if (!row || !row.clientId) throw new NotFoundError("Conversation not found");
  return { linkId: row.linkId, clientId: row.clientId };
}

export async function grantConversation(clientId: string, conversationId: string): Promise<void> {
  const [owned] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, clientId)));
  if (!owned) throw new NotFoundError("Conversation not found");

  const [link] = await db
    .select({ id: therapistLinks.id, therapistId: therapistLinks.therapistId })
    .from(therapistLinks)
    .where(and(eq(therapistLinks.clientId, clientId), eq(therapistLinks.status, "active")));
  // ValidationError, not plain Error: this static message is the only one the
  // share route may echo into a 400 body (see errors.ts).
  if (!link) throw new ValidationError(NO_ACTIVE_LINK_MESSAGE);

  // Idempotent: a second grant for the same (link, conversation) pair is a
  // silent no-op, not an error — the unique index is the real guarantee.
  // `.returning()` is empty on conflict, which is how we know whether to audit.
  const inserted = await db
    .insert(sharingGrants)
    .values({ linkId: link.id, conversationId })
    .onConflictDoNothing({ target: [sharingGrants.linkId, sharingGrants.conversationId] })
    .returning({ id: sharingGrants.id });

  if (inserted.length > 0) {
    await recordAudit({
      clientId,
      therapistId: link.therapistId,
      conversationId,
      action: "grant_created",
      actorId: clientId,
    });
  }
}

export async function revokeGrant(clientId: string, conversationId: string): Promise<void> {
  const [owned] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, clientId)));
  if (!owned) throw new NotFoundError("Conversation not found");

  const links = await db
    .select({ id: therapistLinks.id, therapistId: therapistLinks.therapistId })
    .from(therapistLinks)
    .where(eq(therapistLinks.clientId, clientId));
  if (links.length === 0) return; // idempotent: nothing to revoke

  const linkIds = links.map((l) => l.id);
  const deleted = await db
    .delete(sharingGrants)
    .where(and(eq(sharingGrants.conversationId, conversationId), inArray(sharingGrants.linkId, linkIds)))
    .returning({ linkId: sharingGrants.linkId });
  if (deleted.length === 0) return; // idempotent: no error when nothing to delete

  const therapistId = links.find((l) => l.id === deleted[0]!.linkId)?.therapistId ?? null;
  await recordAudit({ clientId, therapistId, conversationId, action: "grant_revoked", actorId: clientId });
}

// Gate-consistent join: only conversations with a live grant under this
// exact (therapist, client) active link can ever appear here. Titles are
// decrypted with the CLIENT's DEK — the conversation belongs to them, not
// the therapist. Message aggregates (count, last activity, flagged/crisis
// counts) feed the Task 4 attention queue.
export async function listGrantedConversations(
  therapistId: string,
  clientId: string,
): Promise<GrantedConversationSummary[]> {
  const granted = await db
    .select({ id: conversations.id, titleCiphertext: conversations.titleCiphertext, updatedAt: conversations.updatedAt })
    .from(sharingGrants)
    .innerJoin(therapistLinks, eq(sharingGrants.linkId, therapistLinks.id))
    .innerJoin(conversations, eq(sharingGrants.conversationId, conversations.id))
    .where(
      and(
        eq(therapistLinks.therapistId, therapistId),
        eq(therapistLinks.clientId, clientId),
        eq(therapistLinks.status, "active"),
        // Defense-in-depth: the gate independently re-verifies the conversation
        // belongs to the link's client, so a corrupted grant row cannot leak
        // across clients.
        eq(conversations.userId, therapistLinks.clientId),
      ),
    )
    .orderBy(sql`${conversations.updatedAt} desc`);
  if (granted.length === 0) return [];

  const ids = granted.map((g) => g.id);
  const stats = await db
    .select({
      conversationId: messages.conversationId,
      messageCount: count(),
      lastMessageAt: max(messages.createdAt),
      flaggedCount: sql<number>`count(*) filter (where ${messages.flaggedAt} is not null)`.mapWith(Number),
      crisisCount: sql<number>`count(*) filter (where ${messages.riskLevel} = 'crisis')`.mapWith(Number),
    })
    .from(messages)
    .where(inArray(messages.conversationId, ids))
    .groupBy(messages.conversationId);
  const statsByConversation = new Map(stats.map((s) => [s.conversationId, s]));

  const dek = await getOrCreateUserDek(clientId);
  // Same corrupt-row isolation as listConversations/loadMessages: one bad
  // ciphertext must never take the rest of the therapist's list down with it.
  return granted.flatMap((row) => {
    try {
      const title = decryptText(dek, row.titleCiphertext);
      const s = statsByConversation.get(row.id);
      return [
        {
          id: row.id,
          title,
          updatedAt: row.updatedAt,
          lastMessageAt: s?.lastMessageAt ?? null,
          messageCount: s?.messageCount ?? 0,
          flaggedCount: s?.flaggedCount ?? 0,
          crisisCount: s?.crisisCount ?? 0,
        },
      ];
    } catch (error) {
      console.error(`Failed to decrypt granted conversation ${row.id} (${errorCause(error)})`);
      return [];
    }
  });
}

// Client-side display: whether a conversation is currently shared under the
// client's active link. Same gate shape as requireGrantedConversation, seen
// from the client's side.
export async function getGrantStateForClient(clientId: string, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sharingGrants.id })
    .from(sharingGrants)
    .innerJoin(therapistLinks, eq(sharingGrants.linkId, therapistLinks.id))
    .where(
      and(
        eq(sharingGrants.conversationId, conversationId),
        eq(therapistLinks.clientId, clientId),
        eq(therapistLinks.status, "active"),
      ),
    );
  return !!row;
}

export async function listGrantsForClient(clientId: string): Promise<string[]> {
  const rows = await db
    .select({ conversationId: sharingGrants.conversationId })
    .from(sharingGrants)
    .innerJoin(therapistLinks, eq(sharingGrants.linkId, therapistLinks.id))
    .where(and(eq(therapistLinks.clientId, clientId), eq(therapistLinks.status, "active")));
  return rows.map((r) => r.conversationId);
}
