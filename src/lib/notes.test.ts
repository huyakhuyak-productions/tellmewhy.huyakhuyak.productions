import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { messages, selfNotes, user } from "@/db/schema";
import { createConversation, saveMessage } from "./conversations";
import { CryptoError, decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError, ValidationError } from "./errors";
import { createNote, deleteNote, listNotes, MAX_NOTE_BODY_LENGTH } from "./notes";

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

// Inserts a conversation + one encrypted message owned by userId; returns messageId.
// Same seeding idiom as src/lib/digests.test.ts: createConversation + saveMessage
// write both rows with the owner-DEK ciphertext.
async function insertMessage(userId: string, text: string): Promise<string> {
  const conv = await createConversation(userId, "Kept from chat");
  const message = await saveMessage({ conversationId: conv.id, userId, sender: "client", text });
  return message.id;
}

describe("notes", () => {
  let userId: string;
  beforeEach(async () => {
    userId = await insertUser("Note Writer");
  });

  it("stores the body as v1 ciphertext with no plaintext at rest", async () => {
    await createNote(userId, { body: "breathe first, decide after" });
    const [row] = await db.select().from(selfNotes).where(eq(selfNotes.userId, userId));
    expect(row.bodyCiphertext).toMatch(/^v1\./);
    expect(row.bodyCiphertext).not.toContain("breathe first");
    const dek = await getOrCreateUserDek(userId);
    expect(decryptText(dek, row.bodyCiphertext)).toBe("breathe first, decide after");
  });

  it("decrypts only with the owner's DEK — another user's DEK throws", async () => {
    await createNote(userId, { body: "only mine to read" });
    const [row] = await db.select().from(selfNotes).where(eq(selfNotes.userId, userId));

    const otherDek = await getOrCreateUserDek(`test-${randomUUID()}`);
    expect(() => decryptText(otherDek, row.bodyCiphertext)).toThrow(CryptoError);
  });

  it("rejects an empty or over-long body with ValidationError", async () => {
    await expect(createNote(userId, { body: "  " })).rejects.toThrow(ValidationError);
    await expect(createNote(userId, { body: "x".repeat(MAX_NOTE_BODY_LENGTH + 1) })).rejects.toThrow(ValidationError);
    expect(await db.select().from(selfNotes).where(eq(selfNotes.userId, userId))).toHaveLength(0);
  });

  it("keeps a chat message: copies its exact text and records provenance", async () => {
    const messageId = await insertMessage(userId, "I froze in the meeting again");
    const { id } = await createNote(userId, { messageId });
    const notes = await listNotes(userId);
    expect(notes[0]).toMatchObject({ id, body: "I froze in the meeting again", sourceMessageId: messageId });
  });

  it("refuses to keep a message from someone else's conversation — NotFoundError", async () => {
    const otherId = await insertUser("Someone Else");
    const messageId = await insertMessage(otherId, "not yours to keep");
    await expect(createNote(userId, { messageId })).rejects.toThrow(NotFoundError);
    expect(await db.select().from(selfNotes).where(eq(selfNotes.userId, userId))).toHaveLength(0);
  });

  it("refuses a nonexistent message id — NotFoundError", async () => {
    await expect(createNote(userId, { messageId: randomUUID() })).rejects.toThrow(NotFoundError);
  });

  it("a kept note survives its source message's deletion (set-null)", async () => {
    const messageId = await insertMessage(userId, "line worth keeping");
    await createNote(userId, { messageId });
    await db.delete(messages).where(eq(messages.id, messageId));
    const notes = await listNotes(userId);
    expect(notes[0]).toMatchObject({ body: "line worth keeping", sourceMessageId: null });
  });

  it("lists newest first and skips a corrupt row without leaking it", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dek = await getOrCreateUserDek(userId);
    await db.insert(selfNotes).values([
      { userId, bodyCiphertext: encryptText(dek, "older kept line"), createdAt: new Date("2026-01-01T00:00:00Z") },
      { userId, bodyCiphertext: encryptText(dek, "newer kept line"), createdAt: new Date("2026-01-03T00:00:00Z") },
      { userId, bodyCiphertext: "not-valid-ciphertext", createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);

    const notes = await listNotes(userId);
    expect(notes.map((n) => n.body)).toEqual(["newer kept line", "older kept line"]);

    const logged = consoleErrorSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(logged).not.toContain("not-valid-ciphertext");
    consoleErrorSpy.mockRestore();
  });

  it("deletes own note; a foreign or missing noteId is NotFoundError", async () => {
    const { id } = await createNote(userId, { body: "let this one go" });
    await deleteNote(userId, id);
    expect(await listNotes(userId)).toHaveLength(0);

    const otherId = await insertUser("Intruder");
    const { id: theirs } = await createNote(otherId, { body: "theirs" });
    await expect(deleteNote(userId, theirs)).rejects.toThrow(NotFoundError);
    await expect(deleteNote(userId, randomUUID())).rejects.toThrow(NotFoundError);
    // The intruder's note is untouched by the refused delete.
    expect(await listNotes(otherId)).toHaveLength(1);
  });
});
