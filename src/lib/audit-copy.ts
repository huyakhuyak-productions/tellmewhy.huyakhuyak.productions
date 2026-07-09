import type { AuditAction } from "./audit";

// The client's own words for what happened. Calm and factual — the audit feed
// is reassurance ("here's exactly what your trusted person did"), never a
// surveillance ledger. Actions the CLIENT took are phrased in the first
// person; actions the therapist took name them where the name is known, and
// fall back to "your trusted person" for events recorded before a name
// existed (an invite accepted, then read back after a revoke). The conversation
// a line refers to, when there is one, is shown separately as a quiet chip —
// so this stays a pure, title-free sentence.

// Which party actually performed link_invited/link_revoked (the only two
// actions either side can trigger — every other action is fixed by which
// module can even call it: grants only ever come from the client, everything
// else only ever comes from the therapist). "unknown" covers rows written
// before the actor_id column existed, where nothing reliably says who did it.
export type AuditActor = "client" | "therapist" | "unknown";

// Resolved once per row (by the caller, which knows the viewing client's own
// id) and handed to both describeAuditAction (copy) and isClientAction (dot
// color) so the two never disagree about who did what.
export function resolveAuditActor(
  action: AuditAction,
  actorId: string | null,
  clientId: string,
  // The event's own therapistId column — for a legacy (pre-actor_id)
  // link_invited row, this alone already tells us who invited: createInvite
  // only ever writes link_invited with therapistId null (client-initiated);
  // acceptInvite's deferred write for a therapist-initiated invite always has
  // it set. That invariant stands in for the missing actor on old rows.
  eventTherapistId: string | null,
): AuditActor {
  switch (action) {
    case "grant_created":
    case "grant_revoked":
      return "client";
    case "conversation_viewed":
    case "review_marker_advanced":
    case "intervention_sent":
    case "note_published":
    case "link_accepted":
      return "therapist";
    case "link_invited":
      if (actorId !== null) return actorId === clientId ? "client" : "therapist";
      return eventTherapistId === null ? "client" : "therapist";
    case "link_revoked":
      if (actorId === null) return "unknown";
      return actorId === clientId ? "client" : "therapist";
  }
}

export function describeAuditAction(
  action: AuditAction,
  therapistName: string | null,
  actor: AuditActor,
): string {
  const who = therapistName ?? "Your trusted person";
  switch (action) {
    case "link_invited":
      return actor === "client" ? "You invited a trusted person" : `${who} invited you`;
    case "link_accepted":
      return therapistName ? `${therapistName} is now your trusted person` : "Your trusted person joined";
    case "link_revoked":
      if (actor === "client") return "You ended your connection";
      if (actor === "therapist") return `${who} ended your connection`;
      return "Your connection ended"; // legacy row, actor unknown — stay neutral rather than guess
    case "grant_created":
      return "You started sharing a conversation";
    case "grant_revoked":
      return "You stopped sharing a conversation";
    case "conversation_viewed":
      return `${who} read a shared conversation`;
    case "review_marker_advanced":
      return `${who} marked how far they'd read`;
    case "intervention_sent":
      return `${who} wrote to you`;
    case "note_published":
      return `${who} left you a note`;
  }
}

// Drives the two quiet visual treatments in the feed (a muted dot for the
// client's own actions, an accent dot for the therapist's) so the reader can
// tell at a glance which side of the connection an event came from. A
// genuinely unknown actor (legacy link_revoked rows) reads as muted too —
// quiet and non-alarming, never presented as if it were confirmed to be the
// therapist's doing.
export function isClientAction(actor: AuditActor): boolean {
  return actor !== "therapist";
}
