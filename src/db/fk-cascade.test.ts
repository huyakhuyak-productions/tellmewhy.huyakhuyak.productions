import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations, exerciseEntries, exercises, folders, moodCheckins,
  selfNotes, therapistLinks, user, userKeys,
} from "@/db/schema";

// Integration test — requires `docker compose up --detach` and migrations.
// Every user-owned CONTENT table carries an ON DELETE CASCADE FK back to
// `user.id`, so removing the user row is enough to take its owned rows with it.
// This is belt to account-deletion's braces (crypto-shredding) — the FK
// guarantees no owned content row can outlive the user even if a delete path
// forgets to purge it. `user_keys` is the one deliberate exception: it is the
// crypto-shred tombstone, written in the same transaction that deletes the user
// row, so it carries NO FK and must SURVIVE the user's deletion (see schema.ts
// and account-deletion.ts).
describe("user-owned rows cascade on user deletion", () => {
  let userId: string;
  let linkId: string;

  beforeEach(async () => {
    userId = `test-${randomUUID()}`;
    await db.insert(user).values({
      id: userId, name: "Cascade Owner", email: `${userId}@example.com`, role: "client",
    });
    await db.insert(userKeys).values({ userId, wrappedDek: "dek" });
    await db.insert(folders).values({ userId, nameCiphertext: "folder" });
    await db.insert(conversations).values({ userId, titleCiphertext: "title" });
    await db.insert(moodCheckins).values({ userId, day: "2026-07-20", payloadCiphertext: "mood" });
    await db.insert(selfNotes).values({ userId, bodyCiphertext: "note" });

    const [link] = await db.insert(therapistLinks).values({
      clientId: userId, therapistId: `test-${randomUUID()}`, initiatedBy: "client",
      inviteTokenHash: randomUUID(), status: "active", acceptedAt: new Date(),
    }).returning();
    linkId = link.id;

    const [exercise] = await db.insert(exercises).values({
      linkId, clientId: userId, type: "thought_record", instructionCiphertext: "exercise",
    }).returning();
    await db.insert(exerciseEntries).values({
      userId, exerciseId: exercise.id, payloadCiphertext: "entry",
    });
  });

  afterEach(async () => {
    // Idempotent cleanup — leaves the compose DB as we found it whether the
    // cascade fired (green) or the rows survived (red). Children first so the
    // therapist_links row can go last without tripping exercises.link_id.
    await db.delete(exerciseEntries).where(eq(exerciseEntries.userId, userId));
    await db.delete(exercises).where(eq(exercises.clientId, userId));
    await db.delete(selfNotes).where(eq(selfNotes.userId, userId));
    await db.delete(moodCheckins).where(eq(moodCheckins.userId, userId));
    await db.delete(conversations).where(eq(conversations.userId, userId));
    await db.delete(folders).where(eq(folders.userId, userId));
    await db.delete(userKeys).where(eq(userKeys.userId, userId));
    if (linkId) await db.delete(therapistLinks).where(eq(therapistLinks.id, linkId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("takes every owned content row with the user when the user row is deleted", async () => {
    await db.delete(user).where(eq(user.id, userId));

    expect(await db.select().from(folders).where(eq(folders.userId, userId))).toHaveLength(0);
    expect(await db.select().from(conversations).where(eq(conversations.userId, userId))).toHaveLength(0);
    expect(await db.select().from(moodCheckins).where(eq(moodCheckins.userId, userId))).toHaveLength(0);
    expect(await db.select().from(selfNotes).where(eq(selfNotes.userId, userId))).toHaveLength(0);
    expect(await db.select().from(exercises).where(eq(exercises.clientId, userId))).toHaveLength(0);
    expect(await db.select().from(exerciseEntries).where(eq(exerciseEntries.userId, userId))).toHaveLength(0);
  });

  it("keeps the user_keys tombstone: it carries no FK and outlives the user row", async () => {
    // The crypto-shred proof must not be cascaded away. account-deletion.test.ts
    // pins the fuller shred flow (wrapped_dek NULLed by deleteAccount); here we
    // pin only the structural fact that a raw user-row delete cannot take it.
    await db.delete(user).where(eq(user.id, userId));

    expect(await db.select().from(userKeys).where(eq(userKeys.userId, userId))).toHaveLength(1);
  });
});
