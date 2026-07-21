export { noIndexMetadata as metadata } from "@/lib/noindex-metadata";
import { notFound } from "next/navigation";
import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { getReadingView } from "@/lib/therapist-desk";
import { DeskFrame } from "@/components/therapist/desk-frame";
import { ReadingView } from "@/components/therapist/reading-view";
import { requireTherapistPage } from "../../_lib/require-therapist-page";

export default async function TherapistReadingPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const session = await requireTherapistPage();
  const { conversationId } = await params;
  // Reject non-UUID ids before Postgres would 500 on them — same 404 as an
  // ungranted conversation.
  if (!z.uuid().safeParse(conversationId).success) notFound();

  // The attention queue links here with ?focus=<messageId> to land on a
  // specific message. Validate it as a uuid or ignore it entirely — a bad
  // focus never breaks the page, it just doesn't jump.
  const { focus } = await searchParams;
  const focusMessageId = focus && z.uuid().safeParse(focus).success ? focus : null;

  // Rendering the reading view IS a view — getReadingView goes through
  // loadSharedMessages, which audits a (deduped) conversation_viewed, exactly
  // as the API read does. An ungranted/revoked/foreign conversation fails the
  // gate the same indistinguishable way: NotFoundError → 404.
  let view: Awaited<ReturnType<typeof getReadingView>>;
  try {
    view = await getReadingView(session.user.id, conversationId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const back = view.clientName
    ? { href: `/therapist/clients/${view.clientId}`, label: view.clientName }
    : { href: "/therapist", label: "The desk" };

  return (
    <DeskFrame
      back={back}
      title={view.conversationTitle}
      subtitle={
        view.clientName
          ? `Reading ${view.clientName}'s words — as they wrote them.`
          : "Their words, read-only."
      }
    >
      <ReadingView
        conversationId={conversationId}
        clientId={view.clientId}
        messages={view.messages}
        nodes={view.nodes}
        activeLeafId={view.activeLeafId}
        markerMessageId={view.markerMessageId}
        focusMessageId={focusMessageId}
      />
    </DeskFrame>
  );
}
