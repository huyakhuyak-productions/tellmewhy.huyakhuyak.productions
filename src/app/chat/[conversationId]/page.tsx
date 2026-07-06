import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError, listConversations, loadMessages } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { deriveChatStats } from "@/lib/chat-stats";
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

  // Ownership check first and separate: a foreign id must 404 before we do any
  // other work, so the rails/stats fetches never run for a conversation the
  // reader can't see.
  let initialMessages: Awaited<ReturnType<typeof loadMessages>>;
  try {
    initialMessages = await loadMessages(conversationId, session.user.id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [conversationList, folderList] = await Promise.all([
    listConversations(session.user.id),
    listFolders(session.user.id),
  ]);

  const stats = deriveChatStats(conversationList, session.user.createdAt);

  return (
    <ChatScreen
      // Remount per conversation: rail-to-rail navigation reuses the component
      // instance, which would carry the draft/title-watcher ref-guards (and
      // dismissed-crisis state) from one conversation into the next.
      key={conversationId}
      conversationId={conversationId}
      initialMessages={initialMessages}
      conversations={conversationList.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        folderId: c.folderId,
      }))}
      folders={folderList.map((f) => ({ id: f.id, name: f.name }))}
      stats={stats}
    />
  );
}
