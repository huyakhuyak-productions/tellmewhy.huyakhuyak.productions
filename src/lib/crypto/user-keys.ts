import { db } from "@/db";
import { userKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateDek } from "./envelope";
import { getKeyProvider } from "./key-provider";

export async function getOrCreateUserDek(userId: string): Promise<Buffer> {
  const provider = getKeyProvider();
  const existing = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
  if (existing.length > 0) return provider.unwrapDek(existing[0].wrappedDek);

  const dek = generateDek();
  const wrapped = await provider.wrapDek(dek);
  // Concurrent first-message race: the loser of the insert keeps the winner's key.
  await db.insert(userKeys).values({ userId, wrappedDek: wrapped }).onConflictDoNothing();
  const [row] = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
  return provider.unwrapDek(row.wrappedDek);
}

export async function shredUserKey(userId: string): Promise<void> {
  await db.delete(userKeys).where(eq(userKeys.userId, userId));
}
