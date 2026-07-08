import type { AuditAction } from "./audit";

// The client's own words for what happened. Calm and factual — the audit feed
// is reassurance ("here's exactly what your trusted person did"), never a
// surveillance ledger. Actions the CLIENT took are phrased in the first
// person; actions the therapist took name them where the name is known, and
// fall back to "your trusted person" for events recorded before a name
// existed (an invite accepted, then read back after a revoke). The conversation
// a line refers to, when there is one, is shown separately as a quiet chip —
// so this stays a pure, title-free sentence.
export function describeAuditAction(action: AuditAction, therapistName: string | null): string {
  const who = therapistName ?? "Your trusted person";
  switch (action) {
    case "link_invited":
      return "You invited a trusted person";
    case "link_accepted":
      return therapistName ? `${therapistName} is now your trusted person` : "Your trusted person joined";
    case "link_revoked":
      return therapistName ? `You ended your connection with ${therapistName}` : "You ended your connection";
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

// Actions the client themselves performed read as "you …"; the rest are the
// therapist's doing. Drives the two quiet visual treatments in the feed (a
// muted dot for your own actions, an accent dot for theirs) so the reader can
// tell at a glance which side of the connection an event came from.
export function isClientAction(action: AuditAction): boolean {
  return (
    action === "link_invited" ||
    action === "link_revoked" ||
    action === "grant_created" ||
    action === "grant_revoked"
  );
}
