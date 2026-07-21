import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents, exerciseEntries, exercises, user } from "@/db/schema";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";
import { CryptoError, decryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import {
  assignExercise,
  closeExercise,
  getSharedEntryForTherapist,
  listAssignmentsForTherapist,
  listEntriesForClient,
  listExercisesForClient,
  saveEntry,
  shareEntry,
  type ThoughtRecordPayload,
  thoughtRecordSchema,
} from "./exercises";
import { acceptInvite, createInvite, revokeLink } from "./therapist-links";

afterEach(cleanupSeededUsers);

const SAMPLE: ThoughtRecordPayload = {
  situation: "Team standup this morning",
  thoughts: "Everyone can tell I'm falling behind",
  emotions: "anxiety, shame",
  behavior: "stayed silent and avoided eye contact",
};

async function insertUser(name: string): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: "therapist",
  });
  return id;
}

// A client with one active therapist link. The therapist is a real user row so
// listExercisesForClient's name join resolves; the client can stay a bare id.
async function linkedPair(therapistName = "Dr. Test"): Promise<{ clientId: string; therapistId: string; linkId: string }> {
  const clientId = await seedUser();
  const therapistId = await insertUser(therapistName);
  const { linkId, token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  return { clientId, therapistId, linkId };
}

describe("exercises — assignment through the therapist link", () => {
  describe("assignExercise", () => {
    it("assigns through an active link, encrypting the instruction with the CLIENT's DEK", async () => {
      const { clientId, therapistId } = await linkedPair();

      const { id } = await assignExercise(therapistId, clientId, {
        type: "thought_record",
        instruction: "Log one situation that triggered anxiety this week.",
      });

      const [row] = await db.select().from(exercises).where(eq(exercises.id, id));
      expect(row.clientId).toBe(clientId);
      expect(row.status).toBe("active");
      // Ciphertext-at-row: a v1 envelope blob, never plaintext.
      expect(row.instructionCiphertext).toMatch(/^v1\./);

      // The instruction is therapist-authored but client-visible → CLIENT's DEK.
      const clientDek = await getOrCreateUserDek(clientId);
      expect(decryptText(clientDek, row.instructionCiphertext)).toBe(
        "Log one situation that triggered anxiety this week.",
      );
      // Cross-key proof: the therapist's own DEK must NOT decrypt it.
      const therapistDek = await getOrCreateUserDek(therapistId);
      expect(() => decryptText(therapistDek, row.instructionCiphertext)).toThrow(CryptoError);
    });

    it("audits exercise_assigned with ids only, actor = therapist", async () => {
      const { clientId, therapistId } = await linkedPair();

      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "Notice one hot thought." });

      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "exercise_assigned")));
      expect(events).toHaveLength(1);
      expect(events[0].therapistId).toBe(therapistId);
      expect(events[0].actorId).toBe(therapistId);
      // ids + times only — never the instruction text.
      expect(JSON.stringify(events)).not.toContain("hot thought");
    });

    it("refuses to assign when the therapist has no link at all → NotFoundError", async () => {
      const therapistId = await insertUser("Dr. Unlinked");
      const clientId = `test-${randomUUID()}`;

      await expect(
        assignExercise(therapistId, clientId, { type: "thought_record", instruction: "x" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("refuses to assign to a foreign client the therapist is not linked with → NotFoundError", async () => {
      const { therapistId } = await linkedPair();
      const strangerId = `test-${randomUUID()}`;

      await expect(
        assignExercise(therapistId, strangerId, { type: "thought_record", instruction: "x" }),
      ).rejects.toThrow(NotFoundError);
      // Nothing written for the stranger.
      const rows = await db.select().from(exercises).where(eq(exercises.clientId, strangerId));
      expect(rows).toHaveLength(0);
    });

    it("refuses to assign once the link is revoked → NotFoundError", async () => {
      const { clientId, therapistId, linkId } = await linkedPair();
      await revokeLink(linkId, clientId);

      await expect(
        assignExercise(therapistId, clientId, { type: "thought_record", instruction: "x" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects an empty or over-long instruction", async () => {
      const { clientId, therapistId } = await linkedPair();

      await expect(
        assignExercise(therapistId, clientId, { type: "thought_record", instruction: "" }),
      ).rejects.toThrow();
      await expect(
        assignExercise(therapistId, clientId, { type: "thought_record", instruction: "x".repeat(2001) }),
      ).rejects.toThrow();
    });
  });

  describe("closeExercise", () => {
    it("closes an exercise and leaves its entries untouched", async () => {
      const { clientId, therapistId } = await linkedPair();
      const { id } = await assignExercise(therapistId, clientId, {
        type: "thought_record",
        instruction: "Work through one record.",
      });
      // A pre-existing entry against the exercise, to prove close never deletes it.
      const [entry] = await db
        .insert(exerciseEntries)
        .values({ userId: clientId, exerciseId: id, payloadCiphertext: "v1.placeholder" })
        .returning({ id: exerciseEntries.id });

      await closeExercise(therapistId, id);

      const [row] = await db.select().from(exercises).where(eq(exercises.id, id));
      expect(row.status).toBe("closed");
      const [stillThere] = await db.select().from(exerciseEntries).where(eq(exerciseEntries.id, entry.id));
      expect(stillThere).toBeDefined();
    });

    it("refuses close by a non-assigning therapist → NotFoundError", async () => {
      const { clientId, therapistId } = await linkedPair();
      const { id } = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "x" });
      const otherTherapist = await insertUser("Dr. Other");

      await expect(closeExercise(otherTherapist, id)).rejects.toThrow(NotFoundError);
      const [row] = await db.select().from(exercises).where(eq(exercises.id, id));
      expect(row.status).toBe("active");
    });

    it("refuses close once the link is revoked → NotFoundError", async () => {
      const { clientId, therapistId, linkId } = await linkedPair();
      const { id } = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "x" });
      await revokeLink(linkId, clientId);

      await expect(closeExercise(therapistId, id)).rejects.toThrow(NotFoundError);
    });
  });

  describe("listExercisesForClient", () => {
    it("lists the client's assignments newest first, decrypted, with the therapist's name", async () => {
      const { clientId, therapistId } = await linkedPair("Dr. Vega");
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "first" });
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "second" });

      const list = await listExercisesForClient(clientId);
      expect(list.map((e) => e.instruction)).toEqual(["second", "first"]);
      expect(list.every((e) => e.therapistName === "Dr. Vega")).toBe(true);
      expect(list.every((e) => e.status === "active")).toBe(true);
    });

    it("keeps assignments visible after the link is revoked, with therapistName null (client data)", async () => {
      const { clientId, therapistId, linkId } = await linkedPair();
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "still mine" });

      await revokeLink(linkId, clientId);

      const list = await listExercisesForClient(clientId);
      expect(list).toHaveLength(1);
      expect(list[0]!.instruction).toBe("still mine");
      expect(list[0]!.therapistName).toBeNull();
    });

    it("reports linkActive true under a live link and flips it to false once revoked", async () => {
      const { clientId, therapistId, linkId } = await linkedPair();
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "steer me" });

      const before = await listExercisesForClient(clientId);
      expect(before[0]!.linkActive).toBe(true);

      await revokeLink(linkId, clientId);

      const after = await listExercisesForClient(clientId);
      // Still visible as the client's own data — only its steering is over.
      expect(after[0]!.instruction).toBe("steer me");
      expect(after[0]!.linkActive).toBe(false);
    });

    it("never shows another client's assignments", async () => {
      const { clientId, therapistId } = await linkedPair();
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "mine" });
      const otherClient = `test-${randomUUID()}`;

      expect(await listExercisesForClient(otherClient)).toEqual([]);
    });
  });
});

describe("exercise entries — private until each is shared", () => {
  describe("thoughtRecordSchema", () => {
    it("accepts a full valid payload including optional fields", () => {
      const parsed = thoughtRecordSchema.parse({
        ...SAMPLE,
        bodySensations: "tight chest",
        occurredAt: "2026-07-09T09:00",
      });
      expect(parsed.situation).toBe(SAMPLE.situation);
      expect(parsed.bodySensations).toBe("tight chest");
    });

    it("rejects a missing required field", () => {
      expect(() => thoughtRecordSchema.parse({ ...SAMPLE, situation: "" })).toThrow();
      // A required field entirely absent (thoughts) must also be rejected.
      expect(() =>
        thoughtRecordSchema.parse({
          situation: SAMPLE.situation,
          emotions: SAMPLE.emotions,
          behavior: SAMPLE.behavior,
        }),
      ).toThrow();
    });

    it("enforces a max length on each field", () => {
      expect(() => thoughtRecordSchema.parse({ ...SAMPLE, situation: "x".repeat(2001) })).toThrow();
    });
  });

  describe("saveEntry", () => {
    it("saves a self-guided entry (null exerciseId), unshared, encrypted with the CLIENT's DEK", async () => {
      const clientId = await seedUser();

      const { id } = await saveEntry(clientId, { payload: SAMPLE });

      const [row] = await db.select().from(exerciseEntries).where(eq(exerciseEntries.id, id));
      expect(row.exerciseId).toBeNull();
      expect(row.sharedAt).toBeNull();
      expect(row.payloadCiphertext).toMatch(/^v1\./);

      const clientDek = await getOrCreateUserDek(clientId);
      expect(JSON.parse(decryptText(clientDek, row.payloadCiphertext))).toMatchObject(SAMPLE);
      // Cross-key proof: another user's DEK must not decrypt it.
      const strangerDek = await getOrCreateUserDek(`test-${randomUUID()}`);
      expect(() => decryptText(strangerDek, row.payloadCiphertext)).toThrow(CryptoError);
    });

    it("saves an entry against the client's own exercise", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "log it" });

      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });

      const [row] = await db.select().from(exerciseEntries).where(eq(exerciseEntries.id, id));
      expect(row.exerciseId).toBe(exercise.id);
      expect(row.userId).toBe(clientId);
    });

    it("refuses saving against another client's exercise → NotFoundError", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "log it" });
      const stranger = `test-${randomUUID()}`;

      await expect(saveEntry(stranger, { exerciseId: exercise.id, payload: SAMPLE })).rejects.toThrow(NotFoundError);
      const rows = await db.select().from(exerciseEntries).where(eq(exerciseEntries.userId, stranger));
      expect(rows).toHaveLength(0);
    });

    it("refuses an invalid payload", async () => {
      const clientId = `test-${randomUUID()}`;
      await expect(saveEntry(clientId, { payload: { ...SAMPLE, situation: "" } })).rejects.toThrow();
    });
  });

  describe("shareEntry", () => {
    it("shares an entry, stamps sharedAt, audits entry_shared (actor = client), and is idempotent", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "log it" });
      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });

      await shareEntry(clientId, id);
      const [afterFirst] = await db.select().from(exerciseEntries).where(eq(exerciseEntries.id, id));
      expect(afterFirst.sharedAt).not.toBeNull();
      const firstStamp = afterFirst.sharedAt;

      // Idempotent: a second share neither errors, re-stamps, nor re-audits.
      await shareEntry(clientId, id);
      const [afterSecond] = await db.select().from(exerciseEntries).where(eq(exerciseEntries.id, id));
      expect(afterSecond.sharedAt).toEqual(firstStamp);

      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "entry_shared")));
      expect(events).toHaveLength(1);
      expect(events[0].actorId).toBe(clientId);
      expect(events[0].therapistId).toBe(therapistId);
      expect(JSON.stringify(events)).not.toContain("standup");
    });

    it("sharing twice concurrently stamps once and audits once", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "log it" });
      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });

      // Two racing shares of the same entry: the conditional stamp (WHERE
      // shared_at IS NULL) lets exactly one win the row; the loser updates
      // nothing and must not audit, so the trust feed never doubles.
      await Promise.all([shareEntry(clientId, id), shareEntry(clientId, id)]);

      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "entry_shared")));
      expect(rows).toHaveLength(1);
    });

    it("refuses to share a self-guided entry (null exerciseId) → NotFoundError", async () => {
      const clientId = await seedUser();
      const { id } = await saveEntry(clientId, { payload: SAMPLE });

      await expect(shareEntry(clientId, id)).rejects.toThrow(NotFoundError);
      const [row] = await db.select().from(exerciseEntries).where(eq(exerciseEntries.id, id));
      expect(row.sharedAt).toBeNull();
    });

    it("refuses to share another user's entry → NotFoundError", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "log it" });
      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });
      const stranger = `test-${randomUUID()}`;

      await expect(shareEntry(stranger, id)).rejects.toThrow(NotFoundError);
    });

    it("refuses to share once the link is revoked → NotFoundError", async () => {
      const { clientId, therapistId, linkId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "log it" });
      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });
      await revokeLink(linkId, clientId);

      await expect(shareEntry(clientId, id)).rejects.toThrow(NotFoundError);
    });
  });

  describe("listEntriesForClient", () => {
    it("lists all the client's entries newest first, decrypted, including unshared", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "log it" });
      const older = await saveEntry(clientId, { exerciseId: exercise.id, payload: { ...SAMPLE, situation: "older" } });
      const newer = await saveEntry(clientId, { payload: { ...SAMPLE, situation: "newer self-guided" } });
      await shareEntry(clientId, older.id);

      const list = await listEntriesForClient(clientId);
      expect(list.map((e) => e.id)).toEqual([newer.id, older.id]);
      expect(list.map((e) => e.payload.situation)).toEqual(["newer self-guided", "older"]);
      // The unshared self-guided entry is present (this is the client's own view).
      expect(list.find((e) => e.id === newer.id)!.sharedAt).toBeNull();
      expect(list.find((e) => e.id === older.id)!.sharedAt).not.toBeNull();
      expect(list.find((e) => e.id === newer.id)!.exerciseId).toBeNull();
    });
  });

  describe("listAssignmentsForTherapist", () => {
    it("counts ALL entries (shared and unshared) and lists sharedEntryIds — never entry content", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "record it" });
      const sharedEntry = await saveEntry(clientId, { exerciseId: exercise.id, payload: { ...SAMPLE, situation: "SHARED situation" } });
      await saveEntry(clientId, { exerciseId: exercise.id, payload: { ...SAMPLE, situation: "PRIVATE situation" } });
      await shareEntry(clientId, sharedEntry.id);

      const assignments = await listAssignmentsForTherapist(therapistId, clientId);
      expect(assignments).toHaveLength(1);
      const a = assignments[0]!;
      expect(a.id).toBe(exercise.id);
      expect(a.instruction).toBe("record it");
      // Engagement counts BOTH entries; only the shared one is listed by id.
      expect(a.entryCount).toBe(2);
      expect(a.sharedEntryIds).toEqual([sharedEntry.id]);
      expect(a.lastEntryAt).not.toBeNull();
      // No payload content — not the shared one, and certainly not the private one.
      const serialized = JSON.stringify(assignments);
      expect(serialized).not.toContain("SHARED situation");
      expect(serialized).not.toContain("PRIVATE situation");
      expect(serialized).not.toContain("anxiety, shame");
    });

    it("requires an active link owned by the caller — foreign therapist → NotFoundError", async () => {
      const { clientId, therapistId } = await linkedPair();
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "x" });
      const foreignTherapist = await insertUser("Dr. Foreign");

      await expect(listAssignmentsForTherapist(foreignTherapist, clientId)).rejects.toThrow(NotFoundError);
    });

    it("refuses once the link is revoked → NotFoundError", async () => {
      const { clientId, therapistId, linkId } = await linkedPair();
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "x" });
      await revokeLink(linkId, clientId);

      await expect(listAssignmentsForTherapist(therapistId, clientId)).rejects.toThrow(NotFoundError);
    });
  });

  describe("getSharedEntryForTherapist", () => {
    it("returns a shared entry's payload to the assigning therapist and audits entry_viewed (deduped)", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "record it" });
      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });
      await shareEntry(clientId, id);

      const view = await getSharedEntryForTherapist(therapistId, id);
      expect(view.payload).toMatchObject(SAMPLE);
      expect(view.createdAt).toBeInstanceOf(Date);

      // A rapid re-view within the window does not flood the audit feed.
      await getSharedEntryForTherapist(therapistId, id);
      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "entry_viewed")));
      expect(events).toHaveLength(1);
      expect(events[0].actorId).toBe(therapistId);
      expect(events[0].therapistId).toBe(therapistId);
      // Symmetry with the entry-content-absence guard on listAssignments: the
      // entry_viewed row records THAT the entry was read (ids + subject + action)
      // but never a syllable of WHAT was in it.
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(SAMPLE.situation);
      expect(serialized).not.toContain(SAMPLE.thoughts);
      expect(serialized).not.toContain(SAMPLE.emotions);
      expect(serialized).not.toContain(SAMPLE.behavior);
    });

    it("reading two different shared entries writes two entry_viewed lines", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "record it" });
      const entryA = await saveEntry(clientId, { exerciseId: exercise.id, payload: { ...SAMPLE, situation: "A" } });
      const entryB = await saveEntry(clientId, { exerciseId: exercise.id, payload: { ...SAMPLE, situation: "B" } });
      await shareEntry(clientId, entryA.id);
      await shareEntry(clientId, entryB.id);

      await getSharedEntryForTherapist(therapistId, entryA.id);
      await getSharedEntryForTherapist(therapistId, entryB.id);

      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "entry_viewed")));
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.subjectId))).toEqual(new Set([entryA.id, entryB.id]));
    });

    it("re-reading the same entry inside the window stays one line", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "record it" });
      const entryA = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });
      await shareEntry(clientId, entryA.id);

      await getSharedEntryForTherapist(therapistId, entryA.id);
      await getSharedEntryForTherapist(therapistId, entryA.id);

      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "entry_viewed")));
      expect(rows).toHaveLength(1);
      expect(rows[0].subjectId).toBe(entryA.id);
    });

    it("hides an UNSHARED entry (NotFoundError) even though its engagement is still counted", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "record it" });
      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });

      // Half one: the content is invisible.
      await expect(getSharedEntryForTherapist(therapistId, id)).rejects.toThrow(NotFoundError);
      // Half two: the engagement count still includes it.
      const [assignment] = await listAssignmentsForTherapist(therapistId, clientId);
      expect(assignment.entryCount).toBe(1);
      expect(assignment.sharedEntryIds).toEqual([]);
    });

    it("refuses a shared entry once the link is revoked → NotFoundError", async () => {
      const { clientId, therapistId, linkId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "record it" });
      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });
      await shareEntry(clientId, id);

      await revokeLink(linkId, clientId);

      await expect(getSharedEntryForTherapist(therapistId, id)).rejects.toThrow(NotFoundError);
    });

    it("refuses a foreign therapist even for a shared entry → NotFoundError", async () => {
      const { clientId, therapistId } = await linkedPair();
      const exercise = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "record it" });
      const { id } = await saveEntry(clientId, { exerciseId: exercise.id, payload: SAMPLE });
      await shareEntry(clientId, id);
      const foreignTherapist = await insertUser("Dr. Foreign");

      await expect(getSharedEntryForTherapist(foreignTherapist, id)).rejects.toThrow(NotFoundError);
    });
  });
});
