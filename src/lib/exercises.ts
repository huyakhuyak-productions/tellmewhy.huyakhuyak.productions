// Exercises: therapist-assigned homework (thought records) and the client's
// private entries against them. THE consent edge of this phase: a therapist
// assigns work and can count that the client is engaging, but the CONTENT of
// each completed record stays the client's alone until the client shares that
// one entry. Two key domains meet here, both the CLIENT's: an assignment's
// instruction is therapist-authored yet client-visible (the interventions
// law — encrypted with the client's DEK so it survives a therapist account
// deletion), and every entry payload is the client's own data (client DEK).
//
// Access model, read carefully — the same status of a link means different
// things to the two sides:
//   - Therapist-facing reads (listAssignmentsForTherapist,
//     getSharedEntryForTherapist) require the exercise's link to be ACTIVE and
//     owned by the caller. Revocation instantly kills therapist access.
//   - Client-facing reads (listExercisesForClient, listEntriesForClient) are
//     the client's own data and survive revocation — the assignment stays
//     visible, only the therapist's name goes null.
// Every foreign / revoked / unshared / self-guided path resolves to
// NotFoundError, indistinguishable from a row that never existed.
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { exerciseEntries, exercises, therapistLinks, user } from "@/db/schema";
import { recordAudit, recordAuditDeduped } from "./audit";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";

const ENTRY_VIEWED_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

const instructionSchema = z.string().min(1).max(2000);

// The completed thought record — the client's own reflective work. Every field
// is bounded so a corrupt or hostile payload can never balloon the ciphertext;
// bodySensations and occurredAt are optional context the client may skip.
export const thoughtRecordSchema = z.object({
  situation: z.string().min(1).max(2000),
  thoughts: z.string().min(1).max(2000),
  emotions: z.string().min(1).max(2000),
  behavior: z.string().min(1).max(2000),
  bodySensations: z.string().max(2000).optional(),
  occurredAt: z.string().max(100).optional(),
});
export type ThoughtRecordPayload = z.infer<typeof thoughtRecordSchema>;

// The one active link for this exact (therapist, client) pair, or NotFoundError.
// A therapist assigning/reviewing needs standing with THIS client right now;
// a revoked or foreign link is indistinguishable from no link at all. Queried
// directly (not via user-row joins) so the check never depends on either party
// still having a `user` row. Mirrors requireActiveLinkForClientScoped in
// therapist-notes.ts; the one-active-link-per-client invariant is enforced
// structurally by therapist_links_one_per_client_idx (schema.ts).
async function requireActiveLinkForPair(therapistId: string, clientId: string): Promise<string> {
  const [row] = await db
    .select({ id: therapistLinks.id })
    .from(therapistLinks)
    .where(
      and(
        eq(therapistLinks.therapistId, therapistId),
        eq(therapistLinks.clientId, clientId),
        eq(therapistLinks.status, "active"),
      ),
    );
  if (!row) throw new NotFoundError("No active link with this client");
  return row.id;
}

export async function assignExercise(
  therapistId: string,
  clientId: string,
  input: { type: "thought_record"; instruction: string },
): Promise<{ id: string }> {
  // Standing first: only an active link with this exact client can assign.
  const linkId = await requireActiveLinkForPair(therapistId, clientId);
  const instruction = instructionSchema.parse(input.instruction);

  // Client-visible content → CLIENT's DEK, so a deleted therapist account
  // crypto-shreds their notes but never the homework the client can still see.
  const dek = await getOrCreateUserDek(clientId);
  const instructionCiphertext = encryptText(dek, instruction);

  const [row] = await db
    .insert(exercises)
    .values({ linkId, clientId, type: input.type, instructionCiphertext })
    .returning({ id: exercises.id });

  await recordAudit({ clientId, therapistId, action: "exercise_assigned", actorId: therapistId });
  return row;
}

// Only the assigning link's therapist, and only while that link is still
// active, may close an exercise. A non-assigner, a revoked link, or an unknown
// id all fail identically: NotFoundError. Entries are never touched — closing
// an exercise ends new work, it does not erase what was already recorded.
export async function closeExercise(therapistId: string, exerciseId: string): Promise<void> {
  const [row] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .innerJoin(therapistLinks, eq(exercises.linkId, therapistLinks.id))
    .where(
      and(
        eq(exercises.id, exerciseId),
        eq(therapistLinks.therapistId, therapistId),
        eq(therapistLinks.status, "active"),
      ),
    );
  if (!row) throw new NotFoundError("Exercise not found");

  await db.update(exercises).set({ status: "closed" }).where(eq(exercises.id, exerciseId));
}

export type ClientExercise = {
  id: string;
  type: "thought_record";
  instruction: string;
  status: "active" | "closed";
  therapistName: string | null;
  createdAt: Date;
};

// The client's own view of the homework assigned to them. This is CLIENT data,
// so it survives revocation — the assignment stays visible after the link ends,
// with only the therapist's name dropping to null. The name join is gated on
// status = 'active' precisely so a revoked link yields no name (a left join, so
// the exercise row itself always survives). Instructions decrypt with the
// client's own DEK; one bad ciphertext never takes the rest of the list down.
export async function listExercisesForClient(userId: string): Promise<ClientExercise[]> {
  const rows = await db
    .select({
      id: exercises.id,
      type: exercises.type,
      instructionCiphertext: exercises.instructionCiphertext,
      status: exercises.status,
      createdAt: exercises.createdAt,
      therapistName: user.name,
    })
    .from(exercises)
    .leftJoin(therapistLinks, and(eq(exercises.linkId, therapistLinks.id), eq(therapistLinks.status, "active")))
    .leftJoin(user, eq(user.id, therapistLinks.therapistId))
    .where(eq(exercises.clientId, userId))
    .orderBy(desc(exercises.createdAt));

  const dek = await getOrCreateUserDek(userId);
  return rows.flatMap((r) => {
    try {
      return [
        {
          id: r.id,
          type: r.type,
          instruction: decryptText(dek, r.instructionCiphertext),
          status: r.status,
          therapistName: r.therapistName ?? null,
          createdAt: r.createdAt,
        },
      ];
    } catch (error) {
      // Ids + error name/message only — never the instruction plaintext.
      const cause = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      console.error(`Failed to decrypt exercise instruction ${r.id} (${cause})`);
      return [];
    }
  });
}

// A completed thought record. `exerciseId` is optional: a null one is a
// self-guided entry the client wrote on their own initiative — never tied to a
// therapist, therefore never shareable (see shareEntry). When an exerciseId IS
// given it must be one of THIS user's own assignments, or the save is refused
// like a nonexistent id. Payloads always encrypt with the client's own DEK, and
// `sharedAt` starts null — private until the client shares this one entry.
export async function saveEntry(
  userId: string,
  input: { exerciseId?: string; payload: ThoughtRecordPayload },
): Promise<{ id: string }> {
  const payload = thoughtRecordSchema.parse(input.payload);

  if (input.exerciseId) {
    // Only the client's own exercise may anchor their entry — an id belonging
    // to another client is indistinguishable from one that doesn't exist.
    const [owned] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.id, input.exerciseId), eq(exercises.clientId, userId)));
    if (!owned) throw new NotFoundError("Exercise not found");
  }

  const dek = await getOrCreateUserDek(userId);
  const payloadCiphertext = encryptText(dek, JSON.stringify(payload));

  const [row] = await db
    .insert(exerciseEntries)
    .values({ userId, exerciseId: input.exerciseId ?? null, payloadCiphertext })
    .returning({ id: exerciseEntries.id });
  return row;
}

// The client sharing ONE completed entry with their therapist. Three things
// must all hold or it fails as NotFoundError, no hint which: the entry is this
// user's, it is anchored to an exercise (self-guided entries — null exerciseId
// — are structurally excluded by the inner join, so they can never be shared),
// and that exercise's link is still active. Setting sharedAt is idempotent: a
// second share of an already-shared entry is a silent no-op that neither
// re-stamps the time nor writes a second audit row.
export async function shareEntry(userId: string, entryId: string): Promise<void> {
  const [entry] = await db
    .select({
      id: exerciseEntries.id,
      sharedAt: exerciseEntries.sharedAt,
      therapistId: therapistLinks.therapistId,
    })
    .from(exerciseEntries)
    // INNER joins: no row unless the entry has an exercise (excludes self-guided)
    // whose link is currently active. A revoked link drops out here.
    .innerJoin(exercises, eq(exerciseEntries.exerciseId, exercises.id))
    .innerJoin(therapistLinks, and(eq(exercises.linkId, therapistLinks.id), eq(therapistLinks.status, "active")))
    .where(and(eq(exerciseEntries.id, entryId), eq(exerciseEntries.userId, userId)));
  if (!entry) throw new NotFoundError("Entry not found");

  // Already shared — do not re-stamp or re-audit. sharedAt persists on the row
  // even if the link is later revoked, but this idempotent path only runs while
  // the link is active (the join above guarantees it).
  if (entry.sharedAt) return;

  await db.update(exerciseEntries).set({ sharedAt: new Date() }).where(eq(exerciseEntries.id, entryId));
  await recordAudit({ clientId: userId, therapistId: entry.therapistId, action: "entry_shared", actorId: userId });
}

export type ClientEntry = {
  id: string;
  exerciseId: string | null;
  payload: ThoughtRecordPayload;
  sharedAt: Date | null;
  createdAt: Date;
};

// The client's own view of every entry they've written — shared or not,
// self-guided or assigned. Their data, their DEK; one bad ciphertext never
// takes the rest of the list down.
export async function listEntriesForClient(userId: string): Promise<ClientEntry[]> {
  const rows = await db
    .select()
    .from(exerciseEntries)
    .where(eq(exerciseEntries.userId, userId))
    .orderBy(desc(exerciseEntries.createdAt));

  const dek = await getOrCreateUserDek(userId);
  return rows.flatMap((r) => {
    try {
      const payload = JSON.parse(decryptText(dek, r.payloadCiphertext)) as ThoughtRecordPayload;
      return [{ id: r.id, exerciseId: r.exerciseId, payload, sharedAt: r.sharedAt, createdAt: r.createdAt }];
    } catch (error) {
      // Ids + error name/message only — never the payload plaintext.
      const cause = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      console.error(`Failed to decrypt exercise entry ${r.id} (${cause})`);
      return [];
    }
  });
}

export type TherapistAssignment = {
  id: string;
  type: string;
  instruction: string;
  status: string;
  createdAt: Date;
  entryCount: number;
  lastEntryAt: Date | null;
  sharedEntryIds: string[];
};

// The therapist's view of the homework they've assigned this client and how the
// client is engaging with it — but NEVER the content of a completed record.
// Requires an active link owned by the caller (revocation kills this view).
// entryCount and lastEntryAt count ALL entries, shared or not, so a therapist
// can see engagement without seeing private reflections; only sharedEntryIds
// names entries the client chose to share (and only their ids, never their
// payloads). Instructions decrypt with the client's DEK; no entry ciphertext is
// ever even fetched here — the content simply cannot leak through this surface.
export async function listAssignmentsForTherapist(
  therapistId: string,
  clientId: string,
): Promise<TherapistAssignment[]> {
  const linkId = await requireActiveLinkForPair(therapistId, clientId);

  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(eq(exercises.linkId, linkId))
    .orderBy(desc(exercises.createdAt));
  if (exerciseRows.length === 0) return [];

  const exIds = exerciseRows.map((e) => e.id);
  // Ids, timestamps, and the shared flag ONLY — payloadCiphertext is never
  // selected, so entry content has no path into this result.
  const entryRows = await db
    .select({
      id: exerciseEntries.id,
      exerciseId: exerciseEntries.exerciseId,
      sharedAt: exerciseEntries.sharedAt,
      createdAt: exerciseEntries.createdAt,
    })
    .from(exerciseEntries)
    .where(inArray(exerciseEntries.exerciseId, exIds));

  const dek = await getOrCreateUserDek(clientId);
  return exerciseRows.flatMap((ex) => {
    try {
      const instruction = decryptText(dek, ex.instructionCiphertext);
      const entries = entryRows.filter((e) => e.exerciseId === ex.id);
      const lastEntryAt = entries.reduce<Date | null>(
        (latest, e) => (latest === null || e.createdAt > latest ? e.createdAt : latest),
        null,
      );
      const sharedEntryIds = entries.filter((e) => e.sharedAt !== null).map((e) => e.id);
      return [
        {
          id: ex.id,
          type: ex.type,
          instruction,
          status: ex.status,
          createdAt: ex.createdAt,
          entryCount: entries.length,
          lastEntryAt,
          sharedEntryIds,
        },
      ];
    } catch (error) {
      // Ids + error name/message only — never the instruction plaintext.
      const cause = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      console.error(`Failed to decrypt exercise instruction ${ex.id} (${cause})`);
      return [];
    }
  });
}

// The one path by which a therapist reads an entry's content — and it opens
// only when the client has shared THIS entry AND the exercise's link is active
// AND owned by the caller. An unshared entry, a revoked link, a foreign
// therapist, or a self-guided entry (no exercise to join) all fail identically:
// NotFoundError. Decrypts with the client's DEK (their data) and audits
// entry_viewed, deduped so repeat reads don't flood the client's trust feed.
export async function getSharedEntryForTherapist(
  therapistId: string,
  entryId: string,
): Promise<{ payload: ThoughtRecordPayload; createdAt: Date }> {
  const [entry] = await db
    .select({
      payloadCiphertext: exerciseEntries.payloadCiphertext,
      createdAt: exerciseEntries.createdAt,
      clientId: exercises.clientId,
    })
    .from(exerciseEntries)
    .innerJoin(exercises, eq(exerciseEntries.exerciseId, exercises.id))
    .innerJoin(
      therapistLinks,
      and(
        eq(exercises.linkId, therapistLinks.id),
        eq(therapistLinks.status, "active"),
        eq(therapistLinks.therapistId, therapistId),
      ),
    )
    .where(and(eq(exerciseEntries.id, entryId), isNotNull(exerciseEntries.sharedAt)));
  if (!entry) throw new NotFoundError("Entry not found");

  const dek = await getOrCreateUserDek(entry.clientId);
  const payload = JSON.parse(decryptText(dek, entry.payloadCiphertext)) as ThoughtRecordPayload;

  await recordAuditDeduped(
    { clientId: entry.clientId, therapistId, conversationId: null, action: "entry_viewed", actorId: therapistId },
    ENTRY_VIEWED_DEDUPE_WINDOW_MS,
  );

  return { payload, createdAt: entry.createdAt };
}
