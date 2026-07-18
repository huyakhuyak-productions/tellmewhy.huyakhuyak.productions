import { db, type DbExecutor } from "@/db";
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

// Thrown when a caller asks for the DEK of a crypto-shredded user. Every
// resilient read path (per-row try/catch) absorbs it like any decrypt
// failure; nothing may catch it just to mint a fresh key.
export class KeyShreddedError extends Error {}

type UserKeyRow = typeof userKeys.$inferSelect;

function unwrapRow(row: UserKeyRow): Promise<Buffer> {
  if (row.wrappedDek === null) throw new KeyShreddedError("user key was shredded");
  return getKeyProvider().unwrapDek(row.wrappedDek);
}

async function fetchOrCreateUserDek(userId: string): Promise<Buffer> {
  const provider = getKeyProvider();
  const existing = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
  if (existing.length > 0) return unwrapRow(existing[0]);

  const dek = generateDek();
  const wrapped = await provider.wrapDek(dek);
  // Concurrent first-message race: the loser of the insert keeps the winner's
  // key. A race against a concurrent shred resolves to the tombstone.
  await db.insert(userKeys).values({ userId, wrappedDek: wrapped }).onConflictDoNothing();
  const [row] = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
  return unwrapRow(row);
}

// The crypto-shred. Upserts a tombstone (wrapped_dek NULL + shredded_at) so
// the key can never be re-created — even for a user who never had one.
// Accepts a transaction so account deletion can shred atomically.
export async function shredUserKey(userId: string, executor: DbExecutor = db): Promise<void> {
  await executor
    .insert(userKeys)
    .values({ userId, wrappedDek: null, shreddedAt: new Date() })
    .onConflictDoUpdate({
      target: userKeys.userId,
      set: { wrappedDek: null, shreddedAt: new Date() },
    });
}
