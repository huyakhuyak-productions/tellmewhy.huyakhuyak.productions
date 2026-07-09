// Every function here begins with the Task 3 gate — requireGrantedConversation
// — or a query shaped exactly like it (listAttentionItems spans many
// conversations, so it re-expresses the gate's join rather than calling it in
// a loop). No function reaches client data any other way.
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, reviewMarkers, sharingGrants, therapistLinks, user } from "@/db/schema";
import { recordAudit, recordAuditDeduped } from "./audit";
import { decryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import { requireGrantedConversation } from "./sharing";

const ATTENTION_EXCERPT_CODE_POINTS = 140;

export type SharedMessage = {
  id: string;
  sender: "client" | "ai" | "therapist" | "system";
  text: string;
  riskLevel: "none" | "elevated" | "crisis";
  flaggedAt: Date | null;
  authorId: string | null;
  createdAt: Date;
};

// Gate → decrypt via the CLIENT's DEK (the conversation is theirs, not the
// therapist's) → audit conversation_viewed, deduped so re-opening the same
// conversation repeatedly doesn't flood the client's feed with one row per
// page view.
export async function loadSharedMessages(therapistId: string, conversationId: string): Promise<SharedMessage[]> {
  const { clientId } = await requireGrantedConversation(therapistId, conversationId);
  const dek = await getOrCreateUserDek(clientId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  // Same corrupt-row isolation as loadMessages/listGrantedConversations: one
  // bad ciphertext must never take the rest of the read down with it.
  const result = rows.flatMap((r) => {
    try {
      return [
        {
          id: r.id,
          sender: r.sender,
          text: decryptText(dek, r.ciphertext),
          riskLevel: r.riskLevel,
          flaggedAt: r.flaggedAt,
          authorId: r.authorId,
          createdAt: r.createdAt,
        },
      ];
    } catch (error) {
      console.error(`Failed to decrypt shared message ${r.id}`, error);
      return [];
    }
  });

  await recordAuditDeduped({
    clientId,
    therapistId,
    conversationId,
    action: "conversation_viewed",
    actorId: therapistId,
  });
  return result;
}

// Gate + the message must belong to THIS conversation (a message id from a
// different conversation the therapist can also see must still be rejected —
// the review line means something specific: "reviewed up to here, in here").
// Upsert on the (linkId, conversationId) composite key; not deduped — every
// advance is a distinct, meaningful event.
export async function advanceReviewMarker(therapistId: string, conversationId: string, messageId: string): Promise<void> {
  const { linkId, clientId } = await requireGrantedConversation(therapistId, conversationId);

  const [message] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));
  if (!message) throw new NotFoundError("Message not found in this conversation");

  await db
    .insert(reviewMarkers)
    .values({ linkId, conversationId, lastReviewedMessageId: messageId })
    .onConflictDoUpdate({
      target: [reviewMarkers.linkId, reviewMarkers.conversationId],
      set: { lastReviewedMessageId: messageId, updatedAt: new Date() },
    });

  await recordAudit({
    clientId,
    therapistId,
    conversationId,
    action: "review_marker_advanced",
    actorId: therapistId,
  });
}

export type ReviewMarkerForClient = {
  lastReviewedMessageId: string;
  therapistName: string;
  updatedAt: Date;
};

// The client's divider ("Reviewed by <name> up to here"). Mirrors the FULL
// gate, just like listAttentionItems: a live grant for this exact (link,
// conversation) pair, an active link, and the defense-in-depth check that
// the conversation really belongs to the link's client. The divider is an
// indirect surface of shared data — revoking just the grant (link still
// active) must hide it, and re-granting restores it (the marker row itself
// persists; revocation hides, re-grant restores is the designed semantic).
export async function getReviewMarkerForClient(
  clientId: string,
  conversationId: string,
): Promise<ReviewMarkerForClient | null> {
  const [row] = await db
    .select({
      lastReviewedMessageId: reviewMarkers.lastReviewedMessageId,
      updatedAt: reviewMarkers.updatedAt,
      therapistName: user.name,
    })
    .from(reviewMarkers)
    .innerJoin(therapistLinks, eq(reviewMarkers.linkId, therapistLinks.id))
    .innerJoin(
      sharingGrants,
      and(
        eq(sharingGrants.linkId, reviewMarkers.linkId),
        eq(sharingGrants.conversationId, reviewMarkers.conversationId),
      ),
    )
    .innerJoin(conversations, eq(reviewMarkers.conversationId, conversations.id))
    .innerJoin(user, eq(user.id, therapistLinks.therapistId))
    .where(
      and(
        eq(reviewMarkers.conversationId, conversationId),
        eq(therapistLinks.clientId, clientId),
        eq(therapistLinks.status, "active"),
        // Defense-in-depth, same as the gate: the conversation must belong
        // to the link's client — a corrupted marker/grant row cannot leak a
        // divider across clients.
        eq(conversations.userId, therapistLinks.clientId),
      ),
    );
  return row ?? null;
}

export type AttentionItem = {
  conversationId: string;
  clientId: string;
  messageId: string;
  excerpt: string;
  kind: "crisis" | "flag";
  createdAt: Date;
};

function truncateToCodePoints(text: string, max: number): string {
  const codePoints = Array.from(text);
  return codePoints.length <= max ? text : codePoints.slice(0, max).join("");
}

// Crisis-flagged and client-flagged messages across every GRANTED
// conversation for this therapist — never a hint of an ungranted one. This
// re-expresses the gate's own join (active link, therapistId match, defense-
// in-depth re-verification that the conversation belongs to the link's
// client) rather than calling requireGrantedConversation per message, since
// this spans many conversations and clients at once.
export async function listAttentionItems(therapistId: string): Promise<AttentionItem[]> {
  const rows = await db
    .select({
      conversationId: messages.conversationId,
      messageId: messages.id,
      ciphertext: messages.ciphertext,
      riskLevel: messages.riskLevel,
      flaggedAt: messages.flaggedAt,
      createdAt: messages.createdAt,
      clientId: therapistLinks.clientId,
    })
    .from(sharingGrants)
    .innerJoin(therapistLinks, eq(sharingGrants.linkId, therapistLinks.id))
    .innerJoin(conversations, eq(sharingGrants.conversationId, conversations.id))
    .innerJoin(messages, eq(messages.conversationId, sharingGrants.conversationId))
    .where(
      and(
        eq(therapistLinks.therapistId, therapistId),
        eq(therapistLinks.status, "active"),
        eq(conversations.userId, therapistLinks.clientId),
        or(eq(messages.riskLevel, "crisis"), isNotNull(messages.flaggedAt)),
      ),
    )
    .orderBy(desc(messages.createdAt));
  if (rows.length === 0) return [];

  // One DEK unwrap per distinct client, however many of their messages
  // appear here.
  const dekByClient = new Map<string, Buffer>();
  const items: AttentionItem[] = [];
  for (const row of rows) {
    if (!row.clientId) continue;
    let dek = dekByClient.get(row.clientId);
    if (!dek) {
      dek = await getOrCreateUserDek(row.clientId);
      dekByClient.set(row.clientId, dek);
    }
    try {
      const text = decryptText(dek, row.ciphertext);
      items.push({
        conversationId: row.conversationId,
        clientId: row.clientId,
        messageId: row.messageId,
        excerpt: truncateToCodePoints(text, ATTENTION_EXCERPT_CODE_POINTS),
        kind: row.riskLevel === "crisis" ? "crisis" : "flag",
        createdAt: row.createdAt,
      });
    } catch (error) {
      console.error(`Failed to decrypt attention item ${row.messageId}`, error);
    }
  }

  // Crisis before flags; newest first within each group. `rows` was already
  // fetched newest-first, but the initial sort loses that ordering once
  // grouped by kind, so it's restated explicitly here.
  items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "crisis" ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  // Let each affected client know their trusted person checked on their
  // flagged/crisis messages — once per distinct client per read, deduped like
  // conversation_viewed. Not tied to any one conversation (this queue spans
  // many), so conversationId is null; a client who has no items here simply
  // gets no event.
  const distinctClientIds = new Set(items.map((item) => item.clientId));
  await Promise.all(
    Array.from(distinctClientIds).map((distinctClientId) =>
      recordAuditDeduped({
        clientId: distinctClientId,
        therapistId,
        conversationId: null,
        action: "attention_viewed",
        actorId: therapistId,
      }),
    ),
  );

  return items;
}
