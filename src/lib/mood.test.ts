import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditEvents, moodCheckins, therapistLinks, user } from "@/db/schema";
import { CryptoError, decryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError, ValidationError } from "./errors";
import {
  buildMoodContextLine,
  checkInMood,
  getMoodSharingState,
  getMoodTrendForTherapist,
  listMoodCheckins,
  setMoodSharing,
} from "./mood";
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
    role: "client",
  });
  return id;
}

// Client-initiated invite → therapist accepts → an active link.
async function link(clientId: string, therapistId: string): Promise<void> {
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
}

// Relative to the real system clock, so trend-window (last 56 days) tests
// stay valid regardless of when the suite runs.
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("mood — client-owned check-ins, shared on the client's terms", () => {
  let userId: string;

  beforeEach(() => {
    userId = `test-${randomUUID()}`;
  });

  describe("checkInMood", () => {
    it("stores the payload as v1 ciphertext with no plaintext at rest", async () => {
      await checkInMood(userId, { score: 4, note: "slept better" }, "2026-01-10");

      const [row] = await db
        .select()
        .from(moodCheckins)
        .where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.day, "2026-01-10")));
      expect(row.payloadCiphertext).toMatch(/^v1\./);
      expect(row.payloadCiphertext).not.toContain("slept better");

      const dek = await getOrCreateUserDek(userId);
      const payload = JSON.parse(decryptText(dek, row.payloadCiphertext)) as { score: number; note: string | null };
      expect(payload).toEqual({ score: 4, note: "slept better" });
    });

    it("decrypts only with the client's own DEK — another user's DEK throws", async () => {
      await checkInMood(userId, { score: 3 }, "2026-01-11");
      const [row] = await db
        .select()
        .from(moodCheckins)
        .where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.day, "2026-01-11")));

      const otherUserId = `test-${randomUUID()}`;
      const otherDek = await getOrCreateUserDek(otherUserId);
      expect(() => decryptText(otherDek, row.payloadCiphertext)).toThrow(CryptoError);
    });

    it("replaces the score on a same-day check-in instead of creating a second row", async () => {
      await checkInMood(userId, { score: 2 }, "2026-01-12");
      await checkInMood(userId, { score: 5, note: "much better" }, "2026-01-12");

      const rows = await db.select().from(moodCheckins).where(eq(moodCheckins.userId, userId));
      expect(rows).toHaveLength(1);
      const list = await listMoodCheckins(userId, 365);
      expect(list).toEqual([{ day: "2026-01-12", score: 5, note: "much better" }]);
    });

    it.each([0, 6, 2.5])("rejects a score of %s, writing nothing", async (score) => {
      await expect(checkInMood(userId, { score }, "2026-01-13")).rejects.toThrow(ValidationError);
      const rows = await db.select().from(moodCheckins).where(eq(moodCheckins.userId, userId));
      expect(rows).toHaveLength(0);
    });

    it("rejects a note longer than 500 characters, writing nothing", async () => {
      await expect(checkInMood(userId, { score: 3, note: "x".repeat(501) }, "2026-01-14")).rejects.toThrow(ValidationError);
      const rows = await db.select().from(moodCheckins).where(eq(moodCheckins.userId, userId));
      expect(rows).toHaveLength(0);
    });

    it("a note-less re-check-in preserves the existing note", async () => {
      await checkInMood(userId, { score: 4, note: "slept better" }, "2026-01-10");
      await checkInMood(userId, { score: 2 }, "2026-01-10");
      const [checkin] = await listMoodCheckins(userId, 365);
      expect(checkin).toMatchObject({ score: 2, note: "slept better" });
    });

    it("an explicit empty note clears the existing note", async () => {
      await checkInMood(userId, { score: 4, note: "slept better" }, "2026-01-10");
      await checkInMood(userId, { score: 4, note: "" }, "2026-01-10");
      const [checkin] = await listMoodCheckins(userId, 365);
      expect(checkin!.note).toBeNull();
    });

    it("a note-less re-check-in over a corrupt payload does not block the check-in", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await checkInMood(userId, { score: 4, note: "slept better" }, "2026-01-10");
      await db
        .update(moodCheckins)
        .set({ payloadCiphertext: "not-valid-ciphertext" })
        .where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.day, "2026-01-10")));

      await checkInMood(userId, { score: 2 }, "2026-01-10");
      const [checkin] = await listMoodCheckins(userId, 365);
      expect(checkin).toMatchObject({ score: 2, note: null });
      consoleErrorSpy.mockRestore();
    });
  });

  describe("listMoodCheckins", () => {
    it("returns decrypted check-ins ascending by day", async () => {
      await checkInMood(userId, { score: 3 }, "2026-01-05");
      await checkInMood(userId, { score: 4 }, "2026-01-03");
      await checkInMood(userId, { score: 2, note: "rough" }, "2026-01-04");

      const list = await listMoodCheckins(userId, 365);
      expect(list.map((c) => c.day)).toEqual(["2026-01-03", "2026-01-04", "2026-01-05"]);
      expect(list[1]).toEqual({ day: "2026-01-04", score: 2, note: "rough" });
    });

    it("isolates a corrupted row instead of failing the whole list", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await checkInMood(userId, { score: 3 }, "2026-01-06");
      await checkInMood(userId, { score: 4 }, "2026-01-07");
      await db
        .update(moodCheckins)
        .set({ payloadCiphertext: "not-valid-ciphertext" })
        .where(and(eq(moodCheckins.userId, userId), eq(moodCheckins.day, "2026-01-07")));

      const list = await listMoodCheckins(userId, 365);
      expect(list.map((c) => c.day)).toEqual(["2026-01-06"]);
      consoleErrorSpy.mockRestore();
    });
  });

  describe("mood sharing — toggle, state, and the therapist-facing trend", () => {
    let clientId: string;
    let therapistId: string;

    beforeEach(async () => {
      clientId = await insertUser("Robin Client");
      therapistId = await insertUser("Dr. Vale");
    });

    it("refuses to toggle sharing without an active link", async () => {
      const lonelyClientId = `test-${randomUUID()}`;
      await expect(setMoodSharing(lonelyClientId, true)).rejects.toThrow(NotFoundError);
    });

    it("sets and clears moodSharedAt on the active link, reflected by getMoodSharingState", async () => {
      await link(clientId, therapistId);

      expect(await getMoodSharingState(clientId)).toBe(false);
      await setMoodSharing(clientId, true);
      expect(await getMoodSharingState(clientId)).toBe(true);
      const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.clientId, clientId));
      expect(row.moodSharedAt).not.toBeNull();

      await setMoodSharing(clientId, false);
      expect(await getMoodSharingState(clientId)).toBe(false);
      const [cleared] = await db.select().from(therapistLinks).where(eq(therapistLinks.clientId, clientId));
      expect(cleared.moodSharedAt).toBeNull();
    });

    it("refuses the trend when sharing was never toggled on", async () => {
      await link(clientId, therapistId);
      await expect(getMoodTrendForTherapist(therapistId, clientId)).rejects.toThrow(NotFoundError);
    });

    it("refuses the trend once the link is revoked, even if sharing had been toggled on", async () => {
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await setMoodSharing(clientId, true);
      await revokeLink(linkId, clientId);

      await expect(getMoodTrendForTherapist(therapistId, clientId)).rejects.toThrow(NotFoundError);
    });

    it("refuses a foreign therapist's request for the trend", async () => {
      await link(clientId, therapistId);
      await setMoodSharing(clientId, true);
      const foreignTherapistId = await insertUser("Dr. Stranger");

      await expect(getMoodTrendForTherapist(foreignTherapistId, clientId)).rejects.toThrow(NotFoundError);
    });

    it("returns scores and days ONLY — the note field never crosses to the therapist", async () => {
      await link(clientId, therapistId);
      await setMoodSharing(clientId, true);
      const dayOne = daysAgo(2);
      const dayTwo = daysAgo(1);
      await checkInMood(clientId, { score: 4, note: "very private thought" }, dayOne);
      await checkInMood(clientId, { score: 2 }, dayTwo);

      const trend = await getMoodTrendForTherapist(therapistId, clientId);
      expect(trend).toEqual([
        { day: dayOne, score: 4 },
        { day: dayTwo, score: 2 },
      ]);
      for (const entry of trend) expect(entry).not.toHaveProperty("note");
      expect(JSON.stringify(trend)).not.toContain("very private thought");
    });

    it("audits mood_trend_viewed with ids only, deduped across repeat views", async () => {
      await link(clientId, therapistId);
      await setMoodSharing(clientId, true);
      await checkInMood(clientId, { score: 3 }, daysAgo(1));

      await getMoodTrendForTherapist(therapistId, clientId);
      await getMoodTrendForTherapist(therapistId, clientId);

      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "mood_trend_viewed")));
      expect(events).toHaveLength(1);
      expect(events[0]!.therapistId).toBe(therapistId);
      expect(events[0]!.conversationId).toBeNull();
    });
  });

  describe("buildMoodContextLine", () => {
    it("returns null for an empty list", () => {
      expect(buildMoodContextLine([])).toBeNull();
    });

    it("formats a compact, low-good line and includes the client's own notes", () => {
      const line = buildMoodContextLine([
        { day: "2026-07-07", score: 2, note: null },
        { day: "2026-07-08", score: 3, note: "feeling a bit better" },
      ]);
      expect(line).not.toBeNull();
      expect(line).toContain("Recent mood check-ins (1 low");
      expect(line).toContain("2026-07-07: 2");
      expect(line).toContain("2026-07-08: 3");
      expect(line).toContain('"feeling a bit better"');
    });

    it("clamps each note to 100 characters", () => {
      const longNote = "n".repeat(150);
      const line = buildMoodContextLine([{ day: "2026-07-07", score: 3, note: longNote }])!;
      const match = line.match(/"(n+)"/);
      expect(match).not.toBeNull();
      expect(match![1]!.length).toBe(100);
    });

    it("clamps the whole line to 600 characters", () => {
      const checkins = Array.from({ length: 60 }, (_, i) => ({
        day: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
        score: (i % 5) + 1,
        note: "a fairly long note about how the day went overall".repeat(2),
      }));
      const line = buildMoodContextLine(checkins)!;
      expect(line.length).toBeLessThanOrEqual(600);
    });
  });
});
