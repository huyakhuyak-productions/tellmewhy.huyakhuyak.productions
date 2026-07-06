import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";

export class NotFoundError extends Error {}

type Sender = "client" | "ai" | "therapist" | "system";
type RiskLevel = "none" | "elevated" | "crisis";

async function requireOwnedConversation(conversationId: string, userId: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!row) throw new NotFoundError("Conversation not found");
  return row;
}

export async function createConversation(userId: string, title: string): Promise<{ id: string }> {
  const dek = await getOrCreateUserDek(userId);
  const [row] = await db
    .insert(conversations)
    .values({ userId, titleCiphertext: encryptText(dek, title) })
    .returning({ id: conversations.id });
  return row;
}

export async function listConversations(userId: string) {
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt));
  return rows.map((r) => ({ id: r.id, title: decryptText(dek, r.titleCiphertext), updatedAt: r.updatedAt, folderId: r.folderId }));
}

export async function saveMessage(input: {
  conversationId: string;
  userId: string;
  sender: Sender;
  text: string;
  riskLevel?: RiskLevel;
}): Promise<{ id: string }> {
  await requireOwnedConversation(input.conversationId, input.userId);
  const dek = await getOrCreateUserDek(input.userId);
  const [row] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      sender: input.sender,
      ciphertext: encryptText(dek, input.text),
      riskLevel: input.riskLevel ?? "none",
    })
    .returning({ id: messages.id });
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, input.conversationId));
  return row;
}

export async function loadMessages(conversationId: string, userId: string) {
  await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return rows.map((r) => ({
    id: r.id,
    sender: r.sender,
    text: decryptText(dek, r.ciphertext),
    riskLevel: r.riskLevel,
    createdAt: r.createdAt,
  }));
}

export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string,
  opts?: { customized?: boolean },
): Promise<void> {
  await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  await db
    .update(conversations)
    .set({ titleCiphertext: encryptText(dek, title), titleCustomized: opts?.customized ?? true })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
}

export async function isTitleCustomized(conversationId: string, userId: string): Promise<boolean> {
  const row = await requireOwnedConversation(conversationId, userId);
  return row.titleCustomized;
}
