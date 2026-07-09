// Mood check-ins: client-owned (payload under the CLIENT's DEK — never the
// therapist's), one row per (user, day), and shared with a therapist only on
// an explicit, revocable opt-in (moodSharedAt on the active link). Trend reads
// for a therapist are the one adversarial surface here: they must expose
// scores and days ONLY — a client's note is theirs alone, and must never
// reach a therapist-facing function, no matter how sharing is toggled.
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { moodCheckins, therapistLinks } from "@/db/schema";
import { recordAuditDeduped } from "./audit";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import { getActiveLinkForClient, getActiveLinksForTherapist } from "./therapist-links";

const MIN_SCORE = 1;
const MAX_SCORE = 5;
const MAX_NOTE_LENGTH = 500;
const TREND_WINDOW_DAYS = 56;
const CONTEXT_NOTE_CLAMP = 100;
const CONTEXT_LINE_MAX = 600;

export type MoodCheckin = { day: string; score: number; note: string | null };

// The decrypted shape of payloadCiphertext — never returned as-is to a
// therapist-facing caller (see getMoodTrendForTherapist).
type MoodPayload = { score: number; note: string | null };

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoString(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function checkInMood(
  userId: string,
  input: { score: number; note?: string },
  day: string = todayString(),
): Promise<void> {
  if (!Number.isInteger(input.score) || input.score < MIN_SCORE || input.score > MAX_SCORE) {
    throw new Error("Mood score must be a whole number from 1 to 5");
  }
  if (input.note !== undefined && input.note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Mood note must be ${MAX_NOTE_LENGTH} characters or fewer`);
  }

  const dek = await getOrCreateUserDek(userId);
  const payload: MoodPayload = { score: input.score, note: input.note ?? null };
  const payloadCiphertext = encryptText(dek, JSON.stringify(payload));

  // One check-in per (user, day) — a repeat check-in on the same day
  // overwrites the score/note rather than accumulating a second row.
  await db
    .insert(moodCheckins)
    .values({ userId, day, payloadCiphertext })
    .onConflictDoUpdate({
      target: [moodCheckins.userId, moodCheckins.day],
      set: { payloadCiphertext, updatedAt: new Date() },
    });
}

export async function listMoodCheckins(userId: string, sinceDays: number): Promise<MoodCheckin[]> {
  const dek = await getOrCreateUserDek(userId);
  const since = daysAgoString(sinceDays);
  const rows = await db
    .select()
    .from(moodCheckins)
    .where(and(eq(moodCheckins.userId, userId), gte(moodCheckins.day, since)))
    .orderBy(asc(moodCheckins.day));

  // Same corrupt-row isolation as listConversations: one bad ciphertext (or a
  // payload that fails to parse) must never take the rest of the list down.
  return rows.flatMap((r) => {
    try {
      const payload = JSON.parse(decryptText(dek, r.payloadCiphertext)) as MoodPayload;
      return [{ day: r.day, score: payload.score, note: payload.note ?? null }];
    } catch (error) {
      console.error(`Failed to decrypt mood check-in ${r.id}`, error);
      return [];
    }
  });
}

// Client-side toggle: on = stamp moodSharedAt now, off = clear it. Requires
// an active link — a client with no therapist (or a since-revoked one) has
// nothing to toggle.
export async function setMoodSharing(clientId: string, enabled: boolean): Promise<void> {
  const activeLink = await getActiveLinkForClient(clientId);
  if (!activeLink) throw new NotFoundError("No active therapist link");

  await db
    .update(therapistLinks)
    .set({ moodSharedAt: enabled ? new Date() : null })
    .where(eq(therapistLinks.id, activeLink.linkId));
}

export async function getMoodSharingState(clientId: string): Promise<boolean> {
  const activeLink = await getActiveLinkForClient(clientId);
  if (!activeLink) return false;

  const [row] = await db
    .select({ moodSharedAt: therapistLinks.moodSharedAt })
    .from(therapistLinks)
    .where(eq(therapistLinks.id, activeLink.linkId));
  return !!row?.moodSharedAt;
}

// The one therapist-facing read. Gate: an active link for this EXACT
// (therapist, client) pair — getActiveLinksForTherapist already excludes
// revoked links and other therapists' clients — AND moodSharedAt set on it.
// Anything else (no link, foreign therapist, revoked link, toggle never
// enabled) is the same NotFoundError, no hint which check failed.
export async function getMoodTrendForTherapist(
  therapistId: string,
  clientId: string,
): Promise<{ day: string; score: number }[]> {
  const links = await getActiveLinksForTherapist(therapistId);
  const activeLink = links.find((l) => l.clientId === clientId);
  if (!activeLink) throw new NotFoundError("No active link with this client");

  const [linkRow] = await db
    .select({ moodSharedAt: therapistLinks.moodSharedAt })
    .from(therapistLinks)
    .where(eq(therapistLinks.id, activeLink.linkId));
  if (!linkRow?.moodSharedAt) throw new NotFoundError("Mood sharing is not enabled for this client");

  const dek = await getOrCreateUserDek(clientId);
  const since = daysAgoString(TREND_WINDOW_DAYS);
  const rows = await db
    .select()
    .from(moodCheckins)
    .where(and(eq(moodCheckins.userId, clientId), gte(moodCheckins.day, since)))
    .orderBy(asc(moodCheckins.day));

  // Scores + days ONLY — the decrypted payload's note field is read here
  // (decryption is all-or-nothing) but deliberately never placed on the
  // returned object, so it structurally cannot leak to the therapist.
  const trend = rows.flatMap((r) => {
    try {
      const payload = JSON.parse(decryptText(dek, r.payloadCiphertext)) as MoodPayload;
      return [{ day: r.day, score: payload.score }];
    } catch (error) {
      console.error(`Failed to decrypt mood check-in ${r.id}`, error);
      return [];
    }
  });

  await recordAuditDeduped({
    clientId,
    therapistId,
    conversationId: null,
    action: "mood_trend_viewed",
    actorId: therapistId,
  });

  return trend;
}

// Pure — no DB access. This line goes into the CLIENT's OWN chat prompt only
// (Task 6), so unlike getMoodTrendForTherapist it's fine for the client's own
// notes to appear here; it's their data, read back to their own AI.
export function buildMoodContextLine(checkins: MoodCheckin[]): string | null {
  if (checkins.length === 0) return null;

  const scoreSegment = checkins.map((c) => `${c.day}: ${c.score}`).join(", ");
  const notesSegment = checkins
    .filter((c): c is MoodCheckin & { note: string } => !!c.note)
    .map((c) => `"${c.note.length > CONTEXT_NOTE_CLAMP ? c.note.slice(0, CONTEXT_NOTE_CLAMP) : c.note}"`)
    .join(", ");

  let line = `Recent mood check-ins (1 low – 5 good): ${scoreSegment}.`;
  if (notesSegment) line += ` Notes: ${notesSegment}.`;

  return line.length > CONTEXT_LINE_MAX ? line.slice(0, CONTEXT_LINE_MAX) : line;
}
