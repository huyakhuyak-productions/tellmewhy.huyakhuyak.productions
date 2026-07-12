import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError, listConversations, loadMessages } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { deriveChatStats } from "@/lib/chat-stats";
import { getGrantStateForClient, listGrantsForClient } from "@/lib/sharing";
import { listMoodCheckins } from "@/lib/mood";
import { listNotes } from "@/lib/notes";
import { moodTodayUTC } from "@/lib/mood-sparkline";
import { getReviewMarkerForClient } from "@/lib/therapist-access";
import { getActiveLinkForClient, getPendingInviteForClient } from "@/lib/therapist-links";
import { listPublicNotesForClient } from "@/lib/therapist-notes";
import { getUserDisplayNames } from "@/lib/users";
import { ChatScreen } from "@/components/chat/chat-screen";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  // Reject non-UUID ids before they reach Postgres, which would throw a
  // 22P02 error (invalid input syntax) surfaced as a 500 instead of a 404.
  if (!z.uuid().safeParse(conversationId).success) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const userId = session.user.id;

  // Ownership check first and separate: a foreign id must 404 before we do any
  // other work, so the rails/stats/trust fetches never run for a conversation
  // the reader can't see.
  let initialMessages: Awaited<ReturnType<typeof loadMessages>>;
  try {
    initialMessages = await loadMessages(conversationId, userId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [
    conversationList,
    folderList,
    activeLink,
    shared,
    sharedIds,
    reviewMarkerRow,
    publicNotes,
    moodCheckins,
    notesList,
  ] = await Promise.all([
    listConversations(userId),
    listFolders(userId),
    getActiveLinkForClient(userId),
    getGrantStateForClient(userId, conversationId),
    listGrantsForClient(userId),
    getReviewMarkerForClient(userId, conversationId),
    listPublicNotesForClient(userId, conversationId),
    // ~8 weeks of the client's own check-ins for the rail's trend sparkline.
    listMoodCheckins(userId, 56),
    // The person's private kept lines — used here only for the per-message
    // "kept" badge; Task 11's rail panel reuses this same fetch, so the full
    // list stays intact in scope rather than being reduced to just the Set.
    listNotes(userId),
  ]);

  // Which messages already have a kept note, so the affordance can show its
  // settled "kept" state instead of the invitation on first paint.
  const keptMessageIds = new Set(
    notesList.flatMap((n) => (n.sourceMessageId ? [n.sourceMessageId] : [])),
  );

  // Link state for the (now live) stats-rail panel — invited only matters when
  // there's no active link, matching the one-therapist rule.
  const pending = activeLink ? null : await getPendingInviteForClient(userId);

  // Resolve therapist message authors to names by authorId — correct even if
  // the link was later revoked, since the messages themselves remain.
  const authorIds = initialMessages
    .filter((m) => m.sender === "therapist" && m.authorId)
    .map((m) => m.authorId!);
  const authorNames = await getUserDisplayNames(authorIds);

  const messages = initialMessages.map((m) => ({
    id: m.id,
    sender: m.sender,
    text: m.text,
    authorName:
      m.sender === "therapist" ? (m.authorId ? (authorNames.get(m.authorId) ?? null) : null) : undefined,
    flaggedAt: m.sender === "client" ? m.flaggedAt : undefined,
  }));

  const stats = deriveChatStats(conversationList, session.user.createdAt);

  return (
    <ChatScreen
      // Remount per conversation: rail-to-rail navigation reuses the component
      // instance, which would carry the draft/title-watcher ref-guards (and
      // dismissed-crisis state) from one conversation into the next.
      key={conversationId}
      conversationId={conversationId}
      initialMessages={messages}
      conversations={conversationList.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        folderId: c.folderId,
      }))}
      folders={folderList.map((f) => ({ id: f.id, name: f.name }))}
      stats={stats}
      activeLink={activeLink ? { therapistName: activeLink.therapistName } : null}
      shared={shared}
      sharedIds={sharedIds}
      keptMessageIds={[...keptMessageIds]}
      reviewMarker={
        reviewMarkerRow
          ? {
              lastReviewedMessageId: reviewMarkerRow.lastReviewedMessageId,
              therapistName: reviewMarkerRow.therapistName,
            }
          : null
      }
      publicNotes={publicNotes.map((n) => ({
        id: n.id,
        body: n.body,
        therapistName: n.therapistName,
        createdAt: n.createdAt,
      }))}
      therapist={{
        state: activeLink ? "active" : pending ? "invited" : "none",
        therapistName: activeLink?.therapistName ?? null,
        sharedCount: sharedIds.length,
      }}
      mood={{
        checkins: moodCheckins.map((c) => ({ day: c.day, score: c.score })),
        today: moodTodayUTC(),
      }}
    />
  );
}
