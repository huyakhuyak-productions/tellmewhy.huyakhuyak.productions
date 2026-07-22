// Self-serve account deletion: the product's one true delete. Everything
// happens in a single transaction — audit lines, link closure + departure
// markers, the full purge of owned rows, the key tombstone, and the user
// row itself (session + account cascade at the DB). Partner-owned records
// (their notes, the audit trail, the kept link row) survive on purpose;
// see the account-management spec.
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import {
  account, conversations, exerciseEntries, exercises, folders,
  moodCheckins, notes, reviewMarkers, selfNotes, sharingGrants,
  therapistLinks, user,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { encryptText } from "@/lib/crypto/envelope";
import { getOrCreateUserDek, KeyShreddedError, shredUserKey } from "@/lib/crypto/user-keys";
import { errorCause, NotFoundError, ValidationError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";

export async function deleteAccount(userId: string, password: string): Promise<void> {
  const [userRow] = await db.select().from(user).where(eq(user.id, userId));
  if (!userRow) throw new NotFoundError("User not found");

  const [credential] = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
  const ok = credential?.password
    ? await verifyPassword({ hash: credential.password, password })
    : false;
  if (!ok) throw new ValidationError("Incorrect password");

  const links = await db
    .select()
    .from(therapistLinks)
    .where(or(eq(therapistLinks.clientId, userId), eq(therapistLinks.therapistId, userId)));
  const linkIds = links.map((l) => l.id);
  // Only links STILL open (invited/active) with a real partner get closed with
  // a departure marker + name snapshot. A long-revoked ex-partner learns
  // nothing of this deletion and keeps no snapshot — and, crucially, their key
  // may already be tombstoned (they deleted first), so sealing under it would
  // throw KeyShreddedError and deadlock the survivor's own deletion forever.
  const partnered = links.filter(
    (l) =>
      l.clientId !== null &&
      l.therapistId !== null &&
      (l.status === "invited" || l.status === "active"),
  );

  // The departing name, sealed under each SURVIVOR's DEK before the
  // transaction — it is the survivor's record from here on (key-ownership
  // law), and their key must exist for that to hold. A partner who is
  // themselves mid-deletion is the mutual-deletion race: the link read as
  // invited/active, but their concurrent deletion tombstoned their key before
  // this seal. They are not a survivor to inform — their own deletion revokes
  // the link — so we SKIP their marker (returning null, dropped below) rather
  // than let KeyShreddedError 500 the whole deletion. The link still closes in
  // the transaction; it simply carries no departure marker, exactly as a link
  // the partner's tx closes first would.
  const snapshots = (
    await Promise.all(
      partnered.map(async (link) => {
        const partnerId = link.clientId === userId ? link.therapistId! : link.clientId!;
        try {
          const partnerDek = await getOrCreateUserDek(partnerId);
          return { linkId: link.id, ciphertext: encryptText(partnerDek, userRow.name) };
        } catch (error) {
          if (error instanceof KeyShreddedError) {
            console.error(
              `Skipping departure marker for link ${link.id}: partner mid-deletion (${errorCause(error)})`,
            );
            return null;
          }
          throw error;
        }
      }),
    )
  ).filter((snapshot) => snapshot !== null);

  const asTherapistLinkIds = links.filter((l) => l.therapistId === userId).map((l) => l.id);

  await db.transaction(async (tx) => {
    if (partnered.length > 0) {
      for (const link of partnered) {
        await recordAudit(
          {
            clientId: link.clientId!,
            therapistId: link.therapistId,
            actorId: userId,
            action: "account_deleted",
          },
          tx,
        );
      }
    } else {
      await recordAudit(
        { clientId: userId, therapistId: null, actorId: userId, action: "account_deleted" },
        tx,
      );
    }

    // Close every link but KEEP the rows — deleting them would cascade the
    // survivor's notes away. Grants die with the closure, like a manual revoke.
    // The status guard makes the close idempotent against a link a partner
    // revoked concurrently, and `returning` tells us exactly which rows THIS
    // deletion closed — only those may receive a departure marker, so a
    // concurrently-revoked (or concurrently-accepted) link can never end up
    // with an inconsistent marker.
    const now = new Date();
    if (linkIds.length > 0) {
      const closed = await tx
        .update(therapistLinks)
        .set({ status: "revoked", revokedAt: now })
        .where(
          and(
            inArray(therapistLinks.id, linkIds),
            inArray(therapistLinks.status, ["invited", "active"]),
          ),
        )
        .returning({ id: therapistLinks.id });
      const closedIds = new Set(closed.map((r) => r.id));
      await tx.delete(sharingGrants).where(inArray(sharingGrants.linkId, linkIds));
      for (const snapshot of snapshots) {
        if (!closedIds.has(snapshot.linkId)) continue;
        await tx
          .update(therapistLinks)
          .set({ departedAt: now, departedNameCiphertext: snapshot.ciphertext })
          .where(eq(therapistLinks.id, snapshot.linkId));
      }
    }

    // The purge. Messages, digests, grants and markers cascade off
    // conversations; a deleting therapist's notes and markers hang off KEPT
    // link rows, so they go explicitly. Audit rows are never purged.
    await tx.delete(conversations).where(eq(conversations.userId, userId));
    await tx.delete(folders).where(eq(folders.userId, userId));
    await tx.delete(moodCheckins).where(eq(moodCheckins.userId, userId));
    await tx.delete(selfNotes).where(eq(selfNotes.userId, userId));
    await tx.delete(exerciseEntries).where(eq(exerciseEntries.userId, userId));
    await tx.delete(exercises).where(eq(exercises.clientId, userId));
    if (asTherapistLinkIds.length > 0) {
      await tx.delete(notes).where(inArray(notes.linkId, asTherapistLinkIds));
      await tx.delete(reviewMarkers).where(inArray(reviewMarkers.linkId, asTherapistLinkIds));
    }

    await shredUserKey(userId, tx);
    // Last: the account itself. session + account rows cascade — every
    // device is signed out the moment this commits.
    await tx.delete(user).where(eq(user.id, userId));
  });
}
