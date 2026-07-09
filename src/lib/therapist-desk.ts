// The therapist's-desk reads (Task 10 UI). Every client-data read here flows
// through the Task 3 gate primitives — requireGrantedConversation,
// listGrantedConversations, loadSharedMessages, listAttentionItems — or
// author-owned note reads; this module never reaches client data another way.
// It only ENRICHES those primitives with the display labels the desk needs but
// they don't carry: client names, linked-since dates, conversation titles, and
// unread-since-marker counts. Titles and excerpts returned here are already
// decrypted by the primitives (with the CLIENT's DEK), so callers must treat
// them as display data — never widen this surface to leak ids or ciphertext.
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { messages, reviewMarkers, therapistLinks, user } from "@/db/schema";
import {
  type GrantedConversationSummary,
  listGrantedConversations,
  requireGrantedConversation,
} from "./sharing";
import {
  type AttentionItem,
  type SharedMessage,
  listAttentionItems,
  loadSharedMessages,
} from "./therapist-access";
import { getUserDisplayNames } from "./users";

// A therapist's active links, carrying the label + "since" the desk shows.
// Deliberately separate from therapist-links.ts's getActiveLinksForTherapist
// (which backs a shipped, tested API contract) so adding `linkedSince` here
// never changes that response shape. Same gate shape: active link, this
// therapist.
export type TherapistClientLink = {
  clientId: string;
  clientName: string;
  linkedSince: Date | null;
};

export async function getTherapistClientLinks(therapistId: string): Promise<TherapistClientLink[]> {
  const rows = await db
    .select({
      clientId: therapistLinks.clientId,
      clientName: user.name,
      linkedSince: therapistLinks.acceptedAt,
    })
    .from(therapistLinks)
    .innerJoin(user, eq(user.id, therapistLinks.clientId))
    .where(and(eq(therapistLinks.therapistId, therapistId), eq(therapistLinks.status, "active")));
  return rows
    .filter((r): r is typeof r & { clientId: string } => r.clientId !== null)
    .map((r) => ({ clientId: r.clientId, clientName: r.clientName, linkedSince: r.linkedSince }));
}

export type ClientOverview = {
  clientId: string;
  clientName: string;
  linkedSince: Date | null;
  sharedCount: number;
  crisisCount: number;
  flagCount: number;
};

// The dashboard's client list. One gated read per client (a therapist has a
// handful of clients, not thousands), summed into the badges the row shows.
// Ordered so the people who need attention rise to the top — crisis first,
// then flags, then name — the same priority the attention queue encodes.
export async function listClientOverviews(therapistId: string): Promise<ClientOverview[]> {
  const links = await getTherapistClientLinks(therapistId);
  const overviews = await Promise.all(
    links.map(async (link) => {
      const convs = await listGrantedConversations(therapistId, link.clientId);
      return {
        clientId: link.clientId,
        clientName: link.clientName,
        linkedSince: link.linkedSince,
        sharedCount: convs.length,
        crisisCount: convs.reduce((n, c) => n + c.crisisCount, 0),
        flagCount: convs.reduce((n, c) => n + c.flaggedCount, 0),
      };
    }),
  );
  overviews.sort(
    (a, b) =>
      b.crisisCount - a.crisisCount ||
      b.flagCount - a.flagCount ||
      a.clientName.localeCompare(b.clientName),
  );
  return overviews;
}

// An attention item with the display labels the queue needs. The underlying
// list is already crisis-before-flags, newest-first (listAttentionItems), and
// this preserves that order.
export type AttentionEntry = AttentionItem & {
  clientName: string;
  conversationTitle: string;
};

export async function listAttentionQueue(therapistId: string): Promise<AttentionEntry[]> {
  const items = await listAttentionItems(therapistId);
  if (items.length === 0) return [];

  const clientIds = [...new Set(items.map((i) => i.clientId))];
  const [nameMap, titleEntries] = await Promise.all([
    getUserDisplayNames(clientIds),
    Promise.all(
      clientIds.map(async (clientId) => {
        const convs = await listGrantedConversations(therapistId, clientId);
        return convs.map((c) => [c.id, c.title] as const);
      }),
    ),
  ]);
  const titleById = new Map(titleEntries.flat());

  return items.map((item) => ({
    ...item,
    clientName: nameMap.get(item.clientId) ?? "A client",
    conversationTitle: titleById.get(item.conversationId) ?? "Untitled reflection",
  }));
}

export type ConversationForClientView = GrantedConversationSummary & { unreadCount: number };

export type ClientConversationsView = {
  clientName: string | null;
  linkedSince: Date | null;
  conversations: ConversationForClientView[];
};

// The client view's granted-conversation list, each with an unread-since-marker
// count computed server-side: messages that landed strictly after the review
// marker's message. No marker yet means nothing has been reviewed here, so
// every message counts as unread.
export async function getClientConversations(
  therapistId: string,
  clientId: string,
): Promise<ClientConversationsView> {
  const links = await getTherapistClientLinks(therapistId);
  const link = links.find((l) => l.clientId === clientId);
  if (!link) return { clientName: null, linkedSince: null, conversations: [] };

  const convs = await listGrantedConversations(therapistId, clientId);
  if (convs.length === 0) {
    return { clientName: link.clientName, linkedSince: link.linkedSince, conversations: [] };
  }
  const ids = convs.map((c) => c.id);

  const [linkRow] = await db
    .select({ id: therapistLinks.id })
    .from(therapistLinks)
    .where(
      and(
        eq(therapistLinks.therapistId, therapistId),
        eq(therapistLinks.clientId, clientId),
        eq(therapistLinks.status, "active"),
      ),
    );

  const markerRows = linkRow
    ? await db
        .select({
          conversationId: reviewMarkers.conversationId,
          messageId: reviewMarkers.lastReviewedMessageId,
        })
        .from(reviewMarkers)
        .where(and(eq(reviewMarkers.linkId, linkRow.id), inArray(reviewMarkers.conversationId, ids)))
    : [];
  const markerByConversation = new Map(markerRows.map((m) => [m.conversationId, m.messageId]));

  const msgRows = await db
    .select({ id: messages.id, conversationId: messages.conversationId })
    .from(messages)
    .where(inArray(messages.conversationId, ids))
    .orderBy(asc(messages.createdAt));
  const idsByConversation = new Map<string, string[]>();
  for (const row of msgRows) {
    const list = idsByConversation.get(row.conversationId) ?? [];
    list.push(row.id);
    idsByConversation.set(row.conversationId, list);
  }

  const conversations = convs.map((c) => {
    const order = idsByConversation.get(c.id) ?? [];
    const markerId = markerByConversation.get(c.id);
    let unreadCount: number;
    if (!markerId) {
      unreadCount = order.length;
    } else {
      const idx = order.indexOf(markerId);
      unreadCount = idx === -1 ? order.length : order.length - idx - 1;
    }
    return { ...c, unreadCount };
  });

  return { clientName: link.clientName, linkedSince: link.linkedSince, conversations };
}

export type ReadingMessage = {
  id: string;
  sender: "client" | "ai" | "therapist" | "system";
  text: string;
  riskLevel: SharedMessage["riskLevel"];
  flagged: boolean;
  /** Therapist messages only — the real person who wrote it. */
  authorName: string | null;
};

export type ReadingView = {
  clientId: string;
  clientName: string | null;
  conversationTitle: string;
  messages: ReadingMessage[];
  markerMessageId: string | null;
};

// The reading view's data. Routed through loadSharedMessages, which AUDITS the
// view (a deduped conversation_viewed) — a view IS a view, whether it happens
// through the API or a server component rendering the same messages. The gate
// runs first (requireGrantedConversation) for the linkId/clientId the marker
// and header labels need; loadSharedMessages runs it again internally, a cheap
// redundant read with no side effect. Author ids never leave the server — only
// the resolved display name is passed on.
export async function getReadingView(
  therapistId: string,
  conversationId: string,
): Promise<ReadingView> {
  const { linkId, clientId } = await requireGrantedConversation(therapistId, conversationId);
  const shared = await loadSharedMessages(therapistId, conversationId);

  const authorIds = shared
    .filter((m) => m.sender === "therapist" && m.authorId)
    .map((m) => m.authorId!);
  const [markerRow] = await db
    .select({ messageId: reviewMarkers.lastReviewedMessageId })
    .from(reviewMarkers)
    .where(and(eq(reviewMarkers.linkId, linkId), eq(reviewMarkers.conversationId, conversationId)));

  const [authorNames, links, convs] = await Promise.all([
    getUserDisplayNames(authorIds),
    getTherapistClientLinks(therapistId),
    listGrantedConversations(therapistId, clientId),
  ]);

  const messages_ = shared.map((m) => ({
    id: m.id,
    sender: m.sender,
    text: m.text,
    riskLevel: m.riskLevel,
    flagged: m.flaggedAt != null,
    authorName:
      m.sender === "therapist" && m.authorId ? (authorNames.get(m.authorId) ?? null) : null,
  }));

  return {
    clientId,
    clientName: links.find((l) => l.clientId === clientId)?.clientName ?? null,
    conversationTitle: convs.find((c) => c.id === conversationId)?.title ?? "Untitled reflection",
    messages: messages_,
    markerMessageId: markerRow?.messageId ?? null,
  };
}
