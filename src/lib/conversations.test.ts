import { beforeEach, describe, expect, it } from "vitest";
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
});
