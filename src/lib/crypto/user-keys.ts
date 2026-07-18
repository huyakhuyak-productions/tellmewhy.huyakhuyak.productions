import { db } from "@/db";
import { userKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateDek } from "./envelope";
import { getKeyProvider } from "./key-provider";
import { scopedMemo } from "@/lib/request-scope";

// A single chat POST unwraps this user's DEK 3-4x (saveMessage for the
// client turn, loadMessages, saveMessage again for the AI reply, plus
// renameConversation when the title-generation branch runs). Memoizing
// within one request cuts that down to one real unwrap. `scopedMemo` is
// request-scoped only (see request-scope.ts) — it never caches across
// requests, so a raw DEK never outlives the request that decrypted it.
export async function getOrCreateUserDek(userId: string): Promise<Buffer> {
  return scopedMemo(`dek:${userId}`, () => fetchOrCreateUserDek(userId));
}

async function fetchOrCreateUserDek(userId: string): Promise<Buffer> {
  const provider = getKeyProvider();
  const existing = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
  // wrappedDek is nullable in the schema (a shredded row tombstones it to
  // null — see the userKeys comment), but shredUserKey still row-deletes
  // instead of tombstoning until Task 2 wires up the guard, so no row
  // reachable here has a null wrappedDek yet.
  if (existing.length > 0) return provider.unwrapDek(existing[0].wrappedDek!);

  const dek = generateDek();
  const wrapped = await provider.wrapDek(dek);
  // Concurrent first-message race: the loser of the insert keeps the winner's key.
  await db.insert(userKeys).values({ userId, wrappedDek: wrapped }).onConflictDoNothing();
  const [row] = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
  return provider.unwrapDek(row.wrappedDek!);
}

export async function shredUserKey(userId: string): Promise<void> {
  await db.delete(userKeys).where(eq(userKeys.userId, userId));
}
