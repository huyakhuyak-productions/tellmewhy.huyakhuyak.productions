import { listAttentionQueue, listClientOverviews } from "@/lib/therapist-desk";
import { AttentionQueue } from "@/components/therapist/attention-queue";
import { ClientList } from "@/components/therapist/client-list";
import { DeskFrame } from "@/components/therapist/desk-frame";
import { requireTherapistPage } from "./_lib/require-therapist-page";

export default async function TherapistDashboardPage() {
  const session = await requireTherapistPage();

  const [attention, clients] = await Promise.all([
    listAttentionQueue(session.user.id),
    listClientOverviews(session.user.id),
  ]);

  const subtitle =
    clients.length === 0
      ? "No one has linked with you yet."
      : `${clients.length} ${clients.length === 1 ? "person trusts" : "people trust"} you with what they've written.`;

  return (
    <DeskFrame title="Your practice" subtitle={subtitle}>
      <AttentionQueue entries={attention} />
      <ClientList clients={clients} />
    </DeskFrame>
  );
}
