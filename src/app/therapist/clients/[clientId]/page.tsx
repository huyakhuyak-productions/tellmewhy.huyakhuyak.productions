import { notFound } from "next/navigation";
import { getClientConversations } from "@/lib/therapist-desk";
import { listNotesForTherapist } from "@/lib/therapist-notes";
import { ClientConversations } from "@/components/therapist/client-conversations";
import { DeskFrame } from "@/components/therapist/desk-frame";
import { NotesPanel } from "@/components/therapist/notes-panel";
import { requireTherapistPage } from "../../_lib/require-therapist-page";

export default async function TherapistClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session = await requireTherapistPage();
  const { clientId } = await params;

  const [view, notes] = await Promise.all([
    getClientConversations(session.user.id, clientId),
    listNotesForTherapist(session.user.id, clientId),
  ]);

  // No active link with this person → they aren't a client. Same 404 the
  // dashboard would give (they never appear in the roster).
  if (view.clientName === null) notFound();

  const linkedSince = view.linkedSince
    ? `With you since ${view.linkedSince.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`
    : "Recently linked";
  const count = view.conversations.length;
  const shared = count === 0 ? "nothing shared yet" : `${count} ${count === 1 ? "conversation" : "conversations"} shared`;

  return (
    <DeskFrame
      back={{ href: "/therapist", label: "The desk" }}
      title={view.clientName}
      subtitle={`${linkedSince} · ${shared}`}
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-12">
        <ClientConversations conversations={view.conversations} />
        <NotesPanel clientId={clientId} clientName={view.clientName} notes={notes} />
      </div>
    </DeskFrame>
  );
}
