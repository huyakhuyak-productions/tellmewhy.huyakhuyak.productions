import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError, listConversations, listHiddenConversations, loadMessageTree } from "@/lib/conversations";
import { projectMarkerOntoPath, resolveActivePath, versionInfo } from "@/lib/message-tree";
import { listFolders } from "@/lib/folders";
import { deriveChatStats } from "@/lib/chat-stats";
import { getGrantStateForClient, listGrantsForClient } from "@/lib/sharing";
import { listMoodCheckins } from "@/lib/mood";
import { listNotes } from "@/lib/notes";
import { moodTodayUTC } from "@/lib/mood-sparkline";
import { getReviewMarkerForClient, truncateToCodePoints } from "@/lib/therapist-access";
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
  // The whole message forest, flat, plus the active leaf — the raw material the
  // version switcher and the active-path reader both build on. Ownership check
  // lives inside loadMessageTree, so a foreign id still 404s before any other
  // work runs.
  let tree: Awaited<ReturnType<typeof loadMessageTree>>;
  try {
    tree = await loadMessageTree(conversationId, userId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  // Resolve the single root-to-leaf chain the client currently sees. The pure
  // tree math runs over id/parentId/createdAt only; the messages themselves are
  // already decrypted. Everything the screen renders is keyed off this path.
  const nodes = tree.messages.map((m) => ({ id: m.id, parentId: m.parentId, createdAt: m.createdAt }));
  const pathIds = resolveActivePath(nodes, tree.activeLeafId);
  const messageById = new Map(tree.messages.map((m) => [m.id, m]));
  const pathMessages = pathIds.flatMap((id) => {
    const m = messageById.get(id);
    return m ? [m] : [];
  });

  const [
    conversationList,
    hiddenList,
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
    // The client's hidden conversations: the rail's restore drawer, and the
    // check that tells us whether THIS conversation is itself hidden.
    listHiddenConversations(userId),
    listFolders(userId),
    getActiveLinkForClient(userId),
    getGrantStateForClient(userId, conversationId),
    listGrantsForClient(userId),
    getReviewMarkerForClient(userId, conversationId),
    listPublicNotesForClient(userId, conversationId),
    // ~8 weeks of the client's own check-ins for the rail's trend sparkline.
    listMoodCheckins(userId, 56),
    // The person's private kept lines — used here only for the per-message
    // "kept" badge; the rail's notes panel reuses this same fetch, so the full
    // list stays intact in scope rather than being reduced to just the Set.
    listNotes(userId),
  ]);

  // The conversation page loads even for a hidden conversation (loadMessageTree
  // never filters hiddenAt for the owner), so a direct link still opens — the
  // chip just tells the reader it's hidden and offers a one-tap restore.
  const hidden = hiddenList.some((c) => c.id === conversationId);

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
  const authorIds = pathMessages
    .filter((m) => m.sender === "therapist" && m.authorId)
    .map((m) => m.authorId!);
  const authorNames = await getUserDisplayNames(authorIds);

  const messages = pathMessages.map((m) => ({
    id: m.id,
    sender: m.sender,
    text: m.text,
    authorName:
      m.sender === "therapist" ? (m.authorId ? (authorNames.get(m.authorId) ?? null) : null) : undefined,
    flaggedAt: m.sender === "client" ? m.flaggedAt : undefined,
    // Carried so an edit can branch from the same parent (the tree rows
    // already hold it); the client's transport reads it for the wire body.
    parentId: m.parentId,
  }));

  const stats = deriveChatStats(conversationList, session.user.createdAt);

  // Only path messages that belong to a real version set (more than one
  // sibling) get an entry — the switcher mounts exactly where one exists.
  const versions = Object.fromEntries(versionInfo(nodes, pathIds));

  // The therapist's review line follows the version the reader is on: project
  // the stored marker onto the current path (its own node if on-path, else the
  // deepest path node at or before it). A marker older than the whole path — or
  // on a branch this path doesn't touch — projects away, and no divider shows.
  const projectedReviewMarkerId = reviewMarkerRow
    ? projectMarkerOntoPath(nodes, pathIds, reviewMarkerRow.lastReviewedMessageId)
    : null;

  return (
    <ChatScreen
      // Remount per conversation: rail-to-rail navigation reuses the component
      // instance, which would carry the draft/title-watcher ref-guards (and
      // dismissed-crisis state) from one conversation into the next.
      key={conversationId}
      conversationId={conversationId}
      initialMessages={messages}
      versions={versions}
      conversations={conversationList.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        folderId: c.folderId,
      }))}
      folders={folderList.map((f) => ({ id: f.id, name: f.name }))}
      hiddenConversations={hiddenList.map((c) => ({
        id: c.id,
        title: c.title,
        hiddenAt: c.hiddenAt,
      }))}
      hidden={hidden}
      stats={stats}
      activeLink={activeLink ? { therapistName: activeLink.therapistName } : null}
      shared={shared}
      sharedIds={sharedIds}
      keptMessageIds={[...keptMessageIds]}
      reviewMarker={
        reviewMarkerRow && projectedReviewMarkerId
          ? {
              lastReviewedMessageId: projectedReviewMarkerId,
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
      // The rail's peek reuses the same listNotes fetch: the three newest,
      // bodies clamped for the panel. One read serves both the per-message kept
      // badge and this. Clamp by code points so the cut never splits a surrogate
      // pair (an emoji or astral glyph) into a broken half-character.
      notes={notesList.slice(0, 3).map((n) => {
        const clamped = truncateToCodePoints(n.body, 140);
        return {
          id: n.id,
          body: clamped === n.body ? n.body : `${clamped}…`,
          createdAt: n.createdAt,
        };
      })}
    />
  );
}
