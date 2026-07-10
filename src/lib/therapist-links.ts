import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { sharingGrants, therapistLinks, user } from "@/db/schema";
import { recordAudit } from "./audit";
import { NotFoundError, ValidationError } from "./errors";

const TOKEN_BYTES = 32;
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ONE_PER_CLIENT_INDEX = "therapist_links_one_per_client_idx";
const ALREADY_LINKED_MESSAGE = "This client already has a pending or active therapist link";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The pre-checks (hasPendingOrActiveLink) are a fast path with a friendlier
// error, but they're check-then-write and can't stop a concurrent create or
// accept from slipping past between the check and the write. The partial
// unique index on (client_id) WHERE status IN (invited, active) is the real
// guarantee — this turns its 23505 violation into the same error the
// pre-check throws, so callers see one consistent message either way.
// drizzle-orm wraps driver errors in DrizzleQueryError with the original
// postgres.js error on `.cause`, so both layers are checked.
function isOnePerClientIndexError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const constraintName = (error as { constraint_name?: unknown }).constraint_name;
  return code === "23505" && constraintName === ONE_PER_CLIENT_INDEX;
}

function isOnePerClientViolation(error: unknown): boolean {
  return (
    isOnePerClientIndexError(error) ||
    isOnePerClientIndexError((error as { cause?: unknown } | null)?.cause)
  );
}

// A client may have at most one pending-or-active therapist link at a time
// (the one-therapist rule). Checked at create (client-initiated) and again
// at accept (therapist-initiated) — the two directions a second link could
// otherwise sneak in from.
async function hasPendingOrActiveLink(clientId: string): Promise<boolean> {
  const rows = await db
    .select({ id: therapistLinks.id })
    .from(therapistLinks)
    .where(
      and(
        eq(therapistLinks.clientId, clientId),
        or(eq(therapistLinks.status, "invited"), eq(therapistLinks.status, "active")),
      ),
    );
  return rows.length > 0;
}

export async function createInvite(
  initiatorUserId: string,
  initiatedBy: "client" | "therapist",
): Promise<{ linkId: string; token: string }> {
  if (initiatedBy === "client" && (await hasPendingOrActiveLink(initiatorUserId))) {
    throw new ValidationError(ALREADY_LINKED_MESSAGE);
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const inviteTokenHash = hashToken(token);

  let row: { id: string };
  try {
    [row] = await db
      .insert(therapistLinks)
      .values({
        clientId: initiatedBy === "client" ? initiatorUserId : null,
        therapistId: initiatedBy === "therapist" ? initiatorUserId : null,
        initiatedBy,
        inviteTokenHash,
      })
      .returning({ id: therapistLinks.id });
  } catch (error) {
    // The pre-check above is check-then-write and can lose a race to a
    // concurrent createInvite for the same client — the partial unique index
    // is what actually stops the second row from landing.
    if (isOnePerClientViolation(error)) throw new ValidationError(ALREADY_LINKED_MESSAGE);
    throw error;
  }

  // Audit rows are ids + times only. A therapist-initiated invite has no
  // clientId until it's accepted (the column is NOT NULL), so there's nothing
  // to write yet — the create-time audit for that direction happens instead at
  // accept, once a client id exists.
  if (initiatedBy === "client") {
    await recordAudit({
      clientId: initiatorUserId,
      therapistId: null,
      action: "link_invited",
      actorId: initiatorUserId,
    });
  }

  return { linkId: row.id, token };
}

export async function acceptInvite(token: string, acceptingUserId: string): Promise<{ linkId: string }> {
  const inviteTokenHash = hashToken(token);

  const [link] = await db
    .select()
    .from(therapistLinks)
    .where(and(eq(therapistLinks.inviteTokenHash, inviteTokenHash), eq(therapistLinks.status, "invited")));
  if (!link) throw new ValidationError("Invite not found or already used");

  const expiresAt = link.createdAt.getTime() + INVITE_EXPIRY_MS;
  if (Date.now() > expiresAt) throw new ValidationError("Invite has expired");

  const existingPartyId = link.initiatedBy === "client" ? link.clientId : link.therapistId;
  if (existingPartyId === acceptingUserId) throw new ValidationError("Cannot accept your own invite");

  // Therapist-initiated: the acceptor becomes the client — the one-active-
  // link rule applies to them here, since createInvite's create-time check
  // only covers the client-initiated direction.
  if (link.initiatedBy === "therapist" && (await hasPendingOrActiveLink(acceptingUserId))) {
    throw new ValidationError(ALREADY_LINKED_MESSAGE);
  }

  const clientId = link.initiatedBy === "client" ? link.clientId! : acceptingUserId;
  const therapistId = link.initiatedBy === "therapist" ? link.therapistId! : acceptingUserId;

  // Single-use, atomically: only the first accept to land wins the flip from
  // "invited" — a concurrent second accept affects zero rows here. The
  // pre-check above is still a race against a second acceptInvite (or a
  // concurrent createInvite) for the same client — the partial unique index
  // on (client_id) WHERE status IN (invited, active) is what actually stops
  // a second active row for this client from landing.
  let updated: { id: string } | undefined;
  try {
    [updated] = await db
      .update(therapistLinks)
      .set({ clientId, therapistId, status: "active", acceptedAt: new Date() })
      .where(and(eq(therapistLinks.id, link.id), eq(therapistLinks.status, "invited")))
      .returning({ id: therapistLinks.id });
  } catch (error) {
    if (isOnePerClientViolation(error)) throw new ValidationError(ALREADY_LINKED_MESSAGE);
    throw error;
  }
  if (!updated) throw new ValidationError("Invite not found or already used");

  // Role mutates server-side only, and only on a client-initiated accept
  // (the acceptor stepping in as the therapist).
  if (link.initiatedBy === "client") {
    await db.update(user).set({ role: "therapist" }).where(eq(user.id, acceptingUserId));
  }

  // A therapist-initiated invite has no client until now — audit the
  // deferred link_invited alongside link_accepted, both ids now known. Its
  // timestamp is the invite's true creation time, not "now" — the invite
  // existed (and was auditable in spirit) from createdAt, we just couldn't
  // write the row until the client id existed.
  if (link.initiatedBy === "therapist") {
    await recordAudit({
      clientId,
      therapistId,
      action: "link_invited",
      createdAt: link.createdAt,
      // The original inviter — the therapist, for this deferred (therapist-
      // initiated) branch — not the client who just accepted.
      actorId: therapistId,
    });
  }
  // The accept itself is always the acceptor's own action, regardless of who
  // sent the original invite.
  await recordAudit({ clientId, therapistId, action: "link_accepted", actorId: acceptingUserId });

  return { linkId: updated.id };
}

export async function revokeLink(linkId: string, byUserId: string): Promise<void> {
  const [link] = await db
    .select()
    .from(therapistLinks)
    .where(
      and(
        eq(therapistLinks.id, linkId),
        or(eq(therapistLinks.clientId, byUserId), eq(therapistLinks.therapistId, byUserId)),
      ),
    );
  if (!link) throw new NotFoundError("Link not found");

  // Revocation is single-shot: only a link still invited/active has anything
  // left to revoke. A second revoke (or one racing a concurrent revoke)
  // finds nothing to transition, and must neither re-stamp revokedAt nor
  // write a second link_revoked audit row — it's the same NotFoundError path
  // as an unknown link, not a silent no-op success.
  //
  // Grant deletion and the status flip must land together — a link marked
  // revoked while its grants still exist would leave stale reads.
  const revoked = await db.transaction(async (tx) => {
    const updated = await tx
      .update(therapistLinks)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(therapistLinks.id, linkId), inArray(therapistLinks.status, ["invited", "active"])))
      .returning({ id: therapistLinks.id });
    if (updated.length === 0) return false;
    await tx.delete(sharingGrants).where(eq(sharingGrants.linkId, linkId));
    return true;
  });
  if (!revoked) throw new NotFoundError("Link already revoked");

  // A still-pending (never accepted) link has no clientId yet — nothing to
  // audit against the NOT NULL clientId column, same reasoning as createInvite.
  if (link.clientId) {
    await recordAudit({
      clientId: link.clientId,
      therapistId: link.therapistId,
      action: "link_revoked",
      actorId: byUserId,
    });
  }
}

export async function getActiveLinkForClient(
  clientId: string,
): Promise<{ linkId: string; therapistId: string; therapistName: string } | null> {
  const [row] = await db
    .select({ linkId: therapistLinks.id, therapistId: therapistLinks.therapistId, therapistName: user.name })
    .from(therapistLinks)
    .innerJoin(user, eq(user.id, therapistLinks.therapistId))
    .where(and(eq(therapistLinks.clientId, clientId), eq(therapistLinks.status, "active")));
  if (!row || !row.therapistId) return null;
  return { linkId: row.linkId, therapistId: row.therapistId, therapistName: row.therapistName };
}

// A client's own still-pending (invited, never accepted) link, if any. Only a
// client-initiated invite is attributable to a client before acceptance (its
// clientId column is set at create; a therapist-initiated invite has no
// clientId until accept), so this reads straight off that column — the same
// shape /api/links/me already relies on. Complements getActiveLinkForClient
// so the Trust screen can render none → invited → active without a flash.
export async function getPendingInviteForClient(clientId: string): Promise<{ linkId: string } | null> {
  const [row] = await db
    .select({ linkId: therapistLinks.id })
    .from(therapistLinks)
    .where(and(eq(therapistLinks.clientId, clientId), eq(therapistLinks.status, "invited")));
  return row ?? null;
}

export async function getActiveLinksForTherapist(
  therapistId: string,
): Promise<{ linkId: string; clientId: string; clientName: string }[]> {
  const rows = await db
    .select({ linkId: therapistLinks.id, clientId: therapistLinks.clientId, clientName: user.name })
    .from(therapistLinks)
    .innerJoin(user, eq(user.id, therapistLinks.clientId))
    .where(and(eq(therapistLinks.therapistId, therapistId), eq(therapistLinks.status, "active")));
  return rows
    .filter((r): r is typeof r & { clientId: string } => r.clientId !== null)
    .map((r) => ({ linkId: r.linkId, clientId: r.clientId, clientName: r.clientName }));
}
