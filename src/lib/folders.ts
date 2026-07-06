import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, folders } from "@/db/schema";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";

async function requireOwnedFolder(folderId: string, userId: string) {
  const [row] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
  if (!row) throw new NotFoundError("Folder not found");
  return row;
}

export async function createFolder(userId: string, name: string): Promise<{ id: string }> {
  const dek = await getOrCreateUserDek(userId);
  const [row] = await db
    .insert(folders)
    .values({ userId, nameCiphertext: encryptText(dek, name) })
    .returning({ id: folders.id });
  return row;
}

export async function listFolders(userId: string) {
  const dek = await getOrCreateUserDek(userId);
  const rows = await db.select().from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.createdAt));
  return rows.map((r) => ({ id: r.id, name: decryptText(dek, r.nameCiphertext), createdAt: r.createdAt }));
}

export async function renameFolder(folderId: string, userId: string, name: string): Promise<void> {
  await requireOwnedFolder(folderId, userId);
  const dek = await getOrCreateUserDek(userId);
  await db.update(folders).set({ nameCiphertext: encryptText(dek, name) }).where(eq(folders.id, folderId));
}

export async function deleteFolder(folderId: string, userId: string): Promise<void> {
  await requireOwnedFolder(folderId, userId);
  await db.delete(folders).where(eq(folders.id, folderId)); // FK ON DELETE SET NULL unsorts
}

export async function assignConversationToFolder(
  conversationId: string,
  userId: string,
  folderId: string | null,
): Promise<void> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!conv) throw new NotFoundError("Conversation not found");
  if (folderId !== null) await requireOwnedFolder(folderId, userId);
  await db.update(conversations).set({ folderId }).where(eq(conversations.id, conversationId));
}
