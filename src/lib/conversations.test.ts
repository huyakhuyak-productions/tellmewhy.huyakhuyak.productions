import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NotFoundError, createConversation, listConversations, loadMessages, saveMessage } from "./conversations";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";

describe("encrypted conversations", () => {
  let userId: string;
  beforeEach(() => {
    userId = `test-${randomUUID()}`;
  });

  it("stores the title and message bodies as ciphertext only", async () => {
    const { id } = await createConversation(userId, "Feeling overwhelmed");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "I had a rough day" });

    const [convRow] = await db.select().from(conversations).where(eq(conversations.id, id));
    const msgRows = await db.select().from(messages).where(eq(messages.conversationId, id));
    expect(convRow.titleCiphertext).not.toContain("overwhelmed");
    expect(msgRows[0].ciphertext).not.toContain("rough day");
  });

  it("round-trips messages in order with decrypted text", async () => {
    const { id } = await createConversation(userId, "Check-in");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "hello" });
    await saveMessage({ conversationId: id, userId, sender: "ai", text: "hi, how are you feeling?" });

    const loaded = await loadMessages(id, userId);
    expect(loaded.map((m) => [m.sender, m.text])).toEqual([
      ["client", "hello"],
      ["ai", "hi, how are you feeling?"],
    ]);
  });

  it("lists conversations with decrypted titles, newest first", async () => {
    await createConversation(userId, "First");
    await createConversation(userId, "Second");
    const list = await listConversations(userId);
    expect(list.map((c) => c.title)).toEqual(["Second", "First"]);
  });

  it("refuses access to another user's conversation", async () => {
    const { id } = await createConversation(userId, "Private");
    await expect(loadMessages(id, "someone-else")).rejects.toThrow(NotFoundError);
    await expect(
      saveMessage({ conversationId: id, userId: "someone-else", sender: "client", text: "hi" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("persists riskLevel on messages", async () => {
    const { id } = await createConversation(userId, "Hard night");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "…", riskLevel: "crisis" });
    const [m] = await loadMessages(id, userId);
    expect(m.riskLevel).toBe("crisis");
  });

  it("includes the folder assignment in the list", async () => {
    const { createFolder, assignConversationToFolder } = await import("./folders");
    const folder = await createFolder(userId, "work / career");
    const a = await createConversation(userId, "Deadline spiral");
    await createConversation(userId, "Unsorted one");
    await assignConversationToFolder(a.id, userId, folder.id);
    const list = await listConversations(userId);
    expect(list.find((c) => c.id === a.id)?.folderId).toBe(folder.id);
    expect(list.find((c) => c.title === "Unsorted one")?.folderId).toBeNull();
  });

  it("renames with re-encryption and marks the title customized", async () => {
    const { renameConversation, isTitleCustomized } = await import("./conversations");
    const { id } = await createConversation(userId, "July 6");
    await renameConversation(id, userId, "Replaying a work conversation");
    const list = await listConversations(userId);
    expect(list.find((c) => c.id === id)?.title).toBe("Replaying a work conversation");
    expect(await isTitleCustomized(id, userId)).toBe(true);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    expect(row.titleCiphertext).not.toContain("Replaying");
  });

  it("auto-rename (customized: false) does not claim the title for humans", async () => {
    const { renameConversation, isTitleCustomized } = await import("./conversations");
    const { id } = await createConversation(userId, "July 6");
    await renameConversation(id, userId, "A generated title", { customized: false });
    expect(await isTitleCustomized(id, userId)).toBe(false);
  });

  it("refuses foreign rename and metadata reads", async () => {
    const { renameConversation, isTitleCustomized } = await import("./conversations");
    const { id } = await createConversation(userId, "Private");
    await expect(renameConversation(id, "someone-else", "x")).rejects.toThrow(NotFoundError);
    await expect(isTitleCustomized(id, "someone-else")).rejects.toThrow(NotFoundError);
  });

  it("rolls back the message insert if bumping the conversation's updatedAt fails", async () => {
    const { id } = await createConversation(userId, "Transactional");

    // Force the transaction's second statement (the updatedAt bump) to throw,
    // via the real db.transaction/tx — not a hand-rolled mock of "atomicity" —
    // so a genuine Postgres rollback is what we're actually asserting on below.
    const originalTransaction = db.transaction.bind(db);
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementationOnce((callback: Parameters<typeof db.transaction>[0]) =>
      originalTransaction(async (tx) => {
        vi.spyOn(tx, "update").mockImplementationOnce(() => {
          throw new Error("simulated updatedAt bump failure");
        });
        return callback(tx);
      }),
    );

    await expect(
      saveMessage({ conversationId: id, userId, sender: "client", text: "should not persist" }),
    ).rejects.toThrow("simulated updatedAt bump failure");
    transactionSpy.mockRestore();

    const msgRows = await db.select().from(messages).where(eq(messages.conversationId, id));
    expect(msgRows).toHaveLength(0);
  });

  it("skips a conversation with corrupted ciphertext instead of failing the whole list", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const healthy = await createConversation(userId, "Healthy");
    const corrupt = await createConversation(userId, "Will corrupt");
    await db
      .update(conversations)
      .set({ titleCiphertext: "not-valid-ciphertext" })
      .where(eq(conversations.id, corrupt.id));

    const list = await listConversations(userId);
    expect(list.map((c) => c.id)).toContain(healthy.id);
    expect(list.map((c) => c.id)).not.toContain(corrupt.id);
    // Only the row id may be logged — never the ciphertext or decrypted text.
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(corrupt.id), expect.any(Error));
    const [loggedMessage] = consoleErrorSpy.mock.calls[0]!;
    expect(loggedMessage).not.toContain("not-valid-ciphertext");
    consoleErrorSpy.mockRestore();
  });

  it("skips a message with corrupted ciphertext instead of failing the whole conversation", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id } = await createConversation(userId, "Mixed health");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "good message" });
    const corrupt = await saveMessage({ conversationId: id, userId, sender: "client", text: "will corrupt" });
    await db.update(messages).set({ ciphertext: "not-valid-ciphertext" }).where(eq(messages.id, corrupt.id));

    const loaded = await loadMessages(id, userId);
    expect(loaded.map((m) => m.text)).toEqual(["good message"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(corrupt.id), expect.any(Error));
    const [loggedMessage] = consoleErrorSpy.mock.calls[0]!;
    expect(loggedMessage).not.toContain("not-valid-ciphertext");
    consoleErrorSpy.mockRestore();
  });
});
