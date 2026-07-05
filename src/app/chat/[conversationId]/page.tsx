import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NotFoundError, loadMessages } from "@/lib/conversations";
import { ChatScreen } from "@/components/chat/chat-screen";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
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
