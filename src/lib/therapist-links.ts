import { createHash, randomBytes } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, sharingGrants, therapistLinks, user } from "@/db/schema";
import { NotFoundError } from "./errors";

const TOKEN_BYTES = 32;
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type LinkAuditAction = "link_invited" | "link_accepted" | "link_revoked";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

// Audit rows are ids + times only. A therapist-initiated invite has no
// clientId until it's accepted (the column is NOT NULL), so there's nothing
// to write yet — the create-time audit for that direction happens instead at
// accept, once a client id exists.
async function recordAudit(fields: {
  clientId: string;
  therapistId: string | null;
  action: LinkAuditAction;
}): Promise<void> {
  await db.insert(auditEvents).values(fields);
}

export async function createInvite(
  initiatorUserId: string,
  initiatedBy: "client" | "therapist",
): Promise<{ linkId: string; token: string }> {
  if (initiatedBy === "client" && (await hasPendingOrActiveLink(initiatorUserId))) {
    throw new Error("This client already has a pending or active therapist link");
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const inviteTokenHash = hashToken(token);

  const [row] = await db
    .insert(therapistLinks)
    .values({
      clientId: initiatedBy === "client" ? initiatorUserId : null,
      therapistId: initiatedBy === "therapist" ? initiatorUserId : null,
      initiatedBy,
      inviteTokenHash,
    })
    .returning({ id: therapistLinks.id });

  if (initiatedBy === "client") {
    await recordAudit({ clientId: initiatorUserId, therapistId: null, action: "link_invited" });
  }

  return { linkId: row.id, token };
}

export async function acceptInvite(token: string, acceptingUserId: string): Promise<{ linkId: string }> {
  const inviteTokenHash = hashToken(token);

  const [link] = await db
    .select()
    .from(therapistLinks)
    .where(and(eq(therapistLinks.inviteTokenHash, inviteTokenHash), eq(therapistLinks.status, "invited")));
  if (!link) throw new Error("Invite not found or already used");

  const expiresAt = link.createdAt.getTime() + INVITE_EXPIRY_MS;
  if (Date.now() > expiresAt) throw new Error("Invite has expired");

  const existingPartyId = link.initiatedBy === "client" ? link.clientId : link.therapistId;
  if (existingPartyId === acceptingUserId) throw new Error("Cannot accept your own invite");

  // Therapist-initiated: the acceptor becomes the client — the one-active-
  // link rule applies to them here, since createInvite's create-time check
  // only covers the client-initiated direction.
  if (link.initiatedBy === "therapist" && (await hasPendingOrActiveLink(acceptingUserId))) {
    throw new Error("This client already has a pending or active therapist link");
  }

  const clientId = link.initiatedBy === "client" ? link.clientId! : acceptingUserId;
  const therapistId = link.initiatedBy === "therapist" ? link.therapistId! : acceptingUserId;

  // Single-use, atomically: only the first accept to land wins the flip from
  // "invited" — a concurrent second accept affects zero rows here.
  const [updated] = await db
    .update(therapistLinks)
    .set({ clientId, therapistId, status: "active", acceptedAt: new Date() })
    .where(and(eq(therapistLinks.id, link.id), eq(therapistLinks.status, "invited")))
    .returning({ id: therapistLinks.id });
  if (!updated) throw new Error("Invite not found or already used");

  // Role mutates server-side only, and only on a client-initiated accept
  // (the acceptor stepping in as the therapist).
  if (link.initiatedBy === "client") {
    await db.update(user).set({ role: "therapist" }).where(eq(user.id, acceptingUserId));
  }

  // A therapist-initiated invite has no client until now — audit the
  // deferred link_invited alongside link_accepted, both ids now known.
  if (link.initiatedBy === "therapist") {
    await recordAudit({ clientId, therapistId, action: "link_invited" });
  }
  await recordAudit({ clientId, therapistId, action: "link_accepted" });

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

  // Grant deletion and the status flip must land together — a link marked
  // revoked while its grants still exist would leave stale reads.
  await db.transaction(async (tx) => {
    await tx.delete(sharingGrants).where(eq(sharingGrants.linkId, linkId));
    await tx.update(therapistLinks).set({ status: "revoked", revokedAt: new Date() }).where(eq(therapistLinks.id, linkId));
  });

  // A still-pending (never accepted) link has no clientId yet — nothing to
  // audit against the NOT NULL clientId column, same reasoning as createInvite.
  if (link.clientId) {
    await recordAudit({ clientId: link.clientId, therapistId: link.therapistId, action: "link_revoked" });
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
