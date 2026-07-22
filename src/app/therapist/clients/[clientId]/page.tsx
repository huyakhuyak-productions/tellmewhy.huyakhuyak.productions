export { noIndexMetadata as metadata } from "@/lib/noindex-metadata";
import { notFound } from "next/navigation";
import { isUniformNotFound } from "@/lib/errors";
import { listAssignmentsForTherapist } from "@/lib/exercises";
import { getMoodTrendForTherapist } from "@/lib/mood";
import { moodTodayUTC } from "@/lib/mood-sparkline";
import { getClientConversations } from "@/lib/therapist-desk";
import { listNotesForTherapist } from "@/lib/therapist-notes";
import { ClientConversations } from "@/components/therapist/client-conversations";
import { DeskFrame } from "@/components/therapist/desk-frame";
import { ExercisePanel } from "@/components/therapist/exercise-panel";
import { MoodTrend } from "@/components/therapist/mood-trend";
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

  // Past the link guard: homework and the mood trend both need that live link.
  // Mood is a consented, revocable opt-in — a NotFoundError there means the
  // client hasn't shared it, which must be indistinguishable from no data: the
  // panel is simply absent, never a "they haven't enabled this" hint. A
  // NotFoundError from assignments only happens on a revocation race, which is
  // the same not-a-client 404 as the guard above.
  let assignments: Awaited<ReturnType<typeof listAssignmentsForTherapist>>;
  let moodTrend: Awaited<ReturnType<typeof getMoodTrendForTherapist>> | null;
  try {
    [assignments, moodTrend] = await Promise.all([
      listAssignmentsForTherapist(session.user.id, clientId),
      getMoodTrendForTherapist(session.user.id, clientId).catch((error) => {
        if (isUniformNotFound(error)) return null;
        throw error;
      }),
    ]);
  } catch (error) {
    if (isUniformNotFound(error)) notFound();
    throw error;
  }

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
        <div className="flex flex-col gap-10">
          <ClientConversations conversations={view.conversations} />
          <ExercisePanel clientId={clientId} clientName={view.clientName} assignments={assignments} />
        </div>
        <div className="flex flex-col gap-10">
          {moodTrend ? (
            <MoodTrend clientName={view.clientName} trend={moodTrend} today={moodTodayUTC()} />
          ) : null}
          <NotesPanel clientId={clientId} clientName={view.clientName} notes={notes} />
        </div>
      </div>
    </DeskFrame>
  );
}
