import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { deleteAccount } from "./account-deletion";
import { hashPassword } from "./password";
import { ValidationError, NotFoundError } from "./errors";
import { getOrCreateUserDek, KeyShreddedError } from "@/lib/crypto/user-keys";
import { decryptText, encryptText } from "@/lib/crypto/envelope";
import { db } from "@/db";
import {
  account, auditEvents, conversations, exerciseEntries, exercises, folders,
  messages, moodCheckins, notes, selfNotes, session, sharingGrants,
  therapistLinks, user, userKeys,
} from "@/db/schema";

// Integration test — requires `docker compose up --detach` and migrations.
describe("deleteAccount", () => {
  const password = "delete-me-please-1";
  let clientId: string;
  let therapistId: string;
  let linkId: string;

  async function seedUser(id: string, role: string, name: string) {
    await db.insert(user).values({ id, name, email: `${id}@example.com`, role });
    await db.insert(account).values({
      id: randomUUID(), userId: id, accountId: id, providerId: "credential",
      password: await hashPassword(password),
    });
    await db.insert(session).values({
      id: randomUUID(), userId: id, token: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  }

  beforeEach(async () => {
    clientId = `test-${randomUUID()}`;
    therapistId = `test-${randomUUID()}`;
    await seedUser(clientId, "client", "Departing Client");
    await seedUser(therapistId, "therapist", "Their Therapist");

    const clientDek = await getOrCreateUserDek(clientId);
    const therapistDek = await getOrCreateUserDek(therapistId);

    const [link] = await db.insert(therapistLinks).values({
      clientId, therapistId, initiatedBy: "client",
      inviteTokenHash: randomUUID(), status: "active", acceptedAt: new Date(),
    }).returning();
    linkId = link.id;

    const [conv] = await db.insert(conversations).values({
      userId: clientId, titleCiphertext: encryptText(clientDek, "t"),
    }).returning();
    await db.insert(messages).values({
      conversationId: conv.id, sender: "client", ciphertext: encryptText(clientDek, "hello"),
    });
    await db.insert(sharingGrants).values({ linkId, conversationId: conv.id });
    await db.insert(folders).values({ userId: clientId, nameCiphertext: encryptText(clientDek, "f") });
    await db.insert(moodCheckins).values({
      userId: clientId, day: "2026-07-18", payloadCiphertext: encryptText(clientDek, "{}"),
    });
    await db.insert(selfNotes).values({ userId: clientId, bodyCiphertext: encryptText(clientDek, "n") });
    const [exercise] = await db.insert(exercises).values({
      linkId, clientId, type: "thought_record",
      instructionCiphertext: encryptText(clientDek, "i"),
    }).returning();
    await db.insert(exerciseEntries).values({
      userId: clientId, exerciseId: exercise.id, payloadCiphertext: encryptText(clientDek, "{}"),
    });
    await db.insert(notes).values({
      linkId, kind: "private", bodyCiphertext: encryptText(therapistDek, "my note"),
    });
  });

  it("rejects a wrong password and deletes nothing", async () => {
    await expect(deleteAccount(clientId, "wrong-password-1")).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(user).where(eq(user.id, clientId))).toHaveLength(1);
    expect(await db.select().from(conversations).where(eq(conversations.userId, clientId))).toHaveLength(1);
  });

  it("404s for a user that does not exist", async () => {
    await expect(deleteAccount(`test-${randomUUID()}`, password)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("purges every owned row, shreds the key, and removes the account", async () => {
    await deleteAccount(clientId, password);

    for (const [table, column] of [
      [conversations, conversations.userId], [folders, folders.userId],
      [moodCheckins, moodCheckins.userId], [selfNotes, selfNotes.userId],
      [exerciseEntries, exerciseEntries.userId],
    ] as const) {
      expect(await db.select().from(table).where(eq(column, clientId))).toHaveLength(0);
    }
    expect(await db.select().from(exercises).where(eq(exercises.clientId, clientId))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, clientId))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, clientId))).toHaveLength(0);
    expect(await db.select().from(account).where(eq(account.userId, clientId))).toHaveLength(0);

    const [keyRow] = await db.select().from(userKeys).where(eq(userKeys.userId, clientId));
    expect(keyRow.wrappedDek).toBeNull();
    await expect(getOrCreateUserDek(clientId)).rejects.toBeInstanceOf(KeyShreddedError);
  });

  it("keeps the link row revoked with a departure marker, grants gone, notes intact", async () => {
    await deleteAccount(clientId, password);

    const [link] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(link.status).toBe("revoked");
    expect(link.departedAt).not.toBeNull();
    expect(link.departureAcknowledgedAt).toBeNull();
    expect(await db.select().from(sharingGrants).where(eq(sharingGrants.linkId, linkId))).toHaveLength(0);
    expect(await db.select().from(notes).where(eq(notes.linkId, linkId))).toHaveLength(1);
  });

  it("snapshots the departing name so only the survivor's DEK opens it", async () => {
    await deleteAccount(clientId, password);
    const [link] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    const therapistDek = await getOrCreateUserDek(therapistId);
    expect(decryptText(therapistDek, link.departedNameCiphertext!)).toBe("Departing Client");

    // Cross-key proof: any other key must fail to open it.
    const strangerDek = await getOrCreateUserDek(`test-${randomUUID()}`);
    expect(() => decryptText(strangerDek, link.departedNameCiphertext!)).toThrow();
  });

  it("writes one account_deleted audit line per partnered link, actor-attributed", async () => {
    await deleteAccount(clientId, password);
    const rows = await db.select().from(auditEvents).where(
      and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "account_deleted")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].therapistId).toBe(therapistId);
    expect(rows[0].actorId).toBe(clientId);
  });

  it("deleting a therapist purges their notes and markers but never client homework", async () => {
    await deleteAccount(therapistId, password);

    expect(await db.select().from(notes).where(eq(notes.linkId, linkId))).toHaveLength(0);
    expect(await db.select().from(exercises).where(eq(exercises.clientId, clientId))).toHaveLength(1);
    expect(await db.select().from(conversations).where(eq(conversations.userId, clientId))).toHaveLength(1);

    const [link] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(link.status).toBe("revoked");
    expect(link.departedAt).not.toBeNull();
    const clientDek = await getOrCreateUserDek(clientId);
    expect(decryptText(clientDek, link.departedNameCiphertext!)).toBe("Their Therapist");
  });

  it("writes an unpartnered self line when no links exist", async () => {
    const loner = `test-${randomUUID()}`;
    await seedUser(loner, "client", "Loner");
    await deleteAccount(loner, password);
    const rows = await db.select().from(auditEvents).where(
      and(eq(auditEvents.clientId, loner), eq(auditEvents.action, "account_deleted")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].therapistId).toBeNull();
  });
});
