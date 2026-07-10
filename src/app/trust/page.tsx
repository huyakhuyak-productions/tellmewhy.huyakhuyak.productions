import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listAuditEventsForClient } from "@/lib/audit";
import { resolveAuditActor } from "@/lib/audit-copy";
import { listConversations } from "@/lib/conversations";
import { getMoodSharingState } from "@/lib/mood";
import { listGrantsForClient } from "@/lib/sharing";
import { getActiveLinkForClient, getPendingInviteForClient } from "@/lib/therapist-links";
import { listPublicNotesForClient } from "@/lib/therapist-notes";
import { TrustScreen, type TrustLinkState } from "@/components/trust/trust-screen";

// The client's trust surface: who they've let in, exactly what's shared, and a
// plain record of what their trusted person has done. All scoped to the caller
// as a client — a therapist visiting sees only their own client-side state.
export default async function TrustPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/trust");
  const userId = session.user.id;

  const [conversations, activeLink, grantIds, audit, notes, moodShared] = await Promise.all([
    listConversations(userId),
    getActiveLinkForClient(userId),
    listGrantsForClient(userId),
    listAuditEventsForClient(userId),
    listPublicNotesForClient(userId, null),
    getMoodSharingState(userId),
  ]);

  // Only look for a pending invite when there's no active link — the two are
  // mutually exclusive under the one-therapist rule, and this keeps the common
  // (active or none) case to a single extra query at most.
  const pending = activeLink ? null : await getPendingInviteForClient(userId);

  const link: TrustLinkState = activeLink
    ? { kind: "active", linkId: activeLink.linkId, therapistName: activeLink.therapistName }
    : pending
      ? { kind: "invited", linkId: pending.linkId }
      : { kind: "none" };

  const titleById = new Map(conversations.map((c) => [c.id, c.title]));
  const grantSet = new Set(grantIds);
  // Preserve the client's own most-recent-first conversation order for the
  // shared list; a granted conversation whose title failed to decrypt is simply
  // absent from titleById and skipped rather than shown as a blank row.
  const shared = conversations
    .filter((c) => grantSet.has(c.id))
    .map((c) => ({ id: c.id, title: c.title }));

  const auditRows = audit.map((e) => ({
    id: e.id,
    action: e.action,
    therapistName: e.therapistName,
    actor: resolveAuditActor(e.action, e.actorId, userId, e.therapistId),
    title: e.conversationId ? (titleById.get(e.conversationId) ?? null) : null,
    createdAt: e.createdAt,
  }));

  const noteRows = notes.map((n) => ({
    id: n.id,
    body: n.body,
    therapistName: n.therapistName,
    createdAt: n.createdAt,
  }));

  return (
    <TrustScreen link={link} shared={shared} audit={auditRows} notes={noteRows} moodShared={moodShared} />
  );
}
