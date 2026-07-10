import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents, exerciseEntries, exercises, user } from "@/db/schema";
import { CryptoError, decryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import { assignExercise, closeExercise, listExercisesForClient } from "./exercises";
import { acceptInvite, createInvite, revokeLink } from "./therapist-links";

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
  const clientId = `test-${randomUUID()}`;
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

    it("never shows another client's assignments", async () => {
      const { clientId, therapistId } = await linkedPair();
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "mine" });
      const otherClient = `test-${randomUUID()}`;

      expect(await listExercisesForClient(otherClient)).toEqual([]);
    });
  });
});
