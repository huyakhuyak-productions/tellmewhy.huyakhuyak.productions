export { noIndexMetadata as metadata } from "@/lib/noindex-metadata";
import { notFound } from "next/navigation";
import { isUniformNotFound } from "@/lib/errors";
import { listAttentionQueue, listClientOverviews } from "@/lib/therapist-desk";
import { listDepartures } from "@/lib/therapist-links";
import { AttentionQueue } from "@/components/therapist/attention-queue";
import { ClientList } from "@/components/therapist/client-list";
import { DeskFrame } from "@/components/therapist/desk-frame";
import { requireTherapistPage } from "./_lib/require-therapist-page";

export default async function TherapistDashboardPage() {
  const session = await requireTherapistPage();

  // listAttentionQueue and listClientOverviews already skip a mid-deletion
  // CLIENT per-item; listDepartures unwraps the DESK-HOLDER's own DEK, so a
  // therapist whose own key was shredded (their own mid-deletion window) 404s
  // here instead of 500ing — the same notFound() path a missing resource takes.
  const [attention, clients, departures] = await Promise.all([
    listAttentionQueue(session.user.id),
    listClientOverviews(session.user.id),
    listDepartures(session.user.id),
  ]).catch((error) => {
    if (isUniformNotFound(error)) notFound();
    throw error;
  });

  const subtitle =
    clients.length === 0
      ? "No one has linked with you yet."
      : `${clients.length} ${clients.length === 1 ? "person trusts" : "people trust"} you with what they've written.`;

  // The desk speaks only to departed clients. A dual-role therapist may also be
  // party to links where THEY are the client; those farewells belong to their
  // Trust screen, not here.
  const departedClients = departures.filter((d) => d.departedSide === "client");

  return (
    <DeskFrame title="Your practice" subtitle={subtitle}>
      <AttentionQueue entries={attention} />
      <ClientList clients={clients} departures={departedClients} />
    </DeskFrame>
  );
}
