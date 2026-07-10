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
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { exercises, therapistLinks, user } from "@/db/schema";
import { recordAudit } from "./audit";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";

const instructionSchema = z.string().min(1).max(2000);

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
