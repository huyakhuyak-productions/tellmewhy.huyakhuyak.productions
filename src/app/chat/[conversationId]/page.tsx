import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError, loadMessages } from "@/lib/conversations";
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

  let initialMessages: Awaited<ReturnType<typeof loadMessages>>;
  try {
    initialMessages = await loadMessages(conversationId, session.user.id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <ChatScreen
      conversationId={conversationId}
      initialMessages={initialMessages}
    />
  );
}
