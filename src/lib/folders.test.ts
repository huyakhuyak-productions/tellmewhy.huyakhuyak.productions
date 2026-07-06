import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  assignConversationToFolder,
  createFolder,
  deleteFolder,
  listFolders,
  renameFolder,
} from "./folders";
import { NotFoundError, createConversation } from "./conversations";
import { db } from "@/db";
import { conversations, folders } from "@/db/schema";

describe("encrypted folders", () => {
  let userId: string;
  beforeEach(() => {
    userId = `test-${randomUUID()}`;
  });

  it("stores folder names as ciphertext only", async () => {
    const { id } = await createFolder(userId, "relationships");
    const [row] = await db.select().from(folders).where(eq(folders.id, id));
    expect(row.nameCiphertext).not.toContain("relationships");
    expect(row.nameCiphertext).toMatch(/^v1\./);
  });

  it("round-trips folder names and lists in created order", async () => {
    await createFolder(userId, "family");
    await createFolder(userId, "work / career");
    expect((await listFolders(userId)).map((f) => f.name)).toEqual(["family", "work / career"]);
  });

  it("renames with re-encryption", async () => {
    const { id } = await createFolder(userId, "old");
    await renameFolder(id, userId, "friends");
    expect((await listFolders(userId)).map((f) => f.name)).toEqual(["friends"]);
  });

  it("assigns and unassigns a conversation", async () => {
    const folder = await createFolder(userId, "family");
    const conv = await createConversation(userId, "Sunday call");
    await assignConversationToFolder(conv.id, userId, folder.id);
    let [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.folderId).toBe(folder.id);
    await assignConversationToFolder(conv.id, userId, null);
    [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.folderId).toBeNull();
  });

  it("deleting a folder unsorts its conversations without deleting them", async () => {
    const folder = await createFolder(userId, "family");
    const conv = await createConversation(userId, "Sunday call");
    await assignConversationToFolder(conv.id, userId, folder.id);
    await deleteFolder(folder.id, userId);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row).toBeDefined();
    expect(row.folderId).toBeNull();
  });

  it("refuses every foreign-access path", async () => {
    const folder = await createFolder(userId, "private");
    const conv = await createConversation(userId, "mine");
    const stranger = `test-${randomUUID()}`;
    await expect(renameFolder(folder.id, stranger, "x")).rejects.toThrow(NotFoundError);
    await expect(deleteFolder(folder.id, stranger)).rejects.toThrow(NotFoundError);
    // stranger's conversation can't be filed into my folder…
    const strangersConv = await createConversation(stranger, "theirs");
    await expect(assignConversationToFolder(strangersConv.id, userId, folder.id)).rejects.toThrow(NotFoundError);
    // …and my conversation can't be filed into a folder I don't own.
    const strangersFolder = await createFolder(stranger, "theirs");
    await expect(assignConversationToFolder(conv.id, userId, strangersFolder.id)).rejects.toThrow(NotFoundError);
  });
});
