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
import { getOrCreateUserDek, shredUserKey } from "@/lib/crypto/user-keys";
import { NotFoundError, ValidationError } from "@/lib/errors";
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
  const partnered = links.filter((l) => l.clientId !== null && l.therapistId !== null);

  // The departing name, sealed under each SURVIVOR's DEK before the
  // transaction — it is the survivor's record from here on (key-ownership
  // law), and their key must exist for that to hold.
  const snapshots = await Promise.all(
    partnered.map(async (link) => {
      const partnerId = link.clientId === userId ? link.therapistId! : link.clientId!;
      const partnerDek = await getOrCreateUserDek(partnerId);
      return { linkId: link.id, ciphertext: encryptText(partnerDek, userRow.name) };
    }),
  );

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
    if (linkIds.length > 0) {
      await tx
        .update(therapistLinks)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            inArray(therapistLinks.id, linkIds),
            inArray(therapistLinks.status, ["invited", "active"]),
          ),
        );
      await tx.delete(sharingGrants).where(inArray(sharingGrants.linkId, linkIds));
    }
    for (const snapshot of snapshots) {
      await tx
        .update(therapistLinks)
        .set({ departedAt: new Date(), departedNameCiphertext: snapshot.ciphertext })
        .where(eq(therapistLinks.id, snapshot.linkId));
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
