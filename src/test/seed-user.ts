import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";

// Every user-owned content table now carries an ON DELETE CASCADE FK back to
// `user.id` (migration 0016), so a synthetic `test-…` owner id can no longer
// own conversations/exercises/folders/mood/notes/entries unless a real `user`
// row exists first. These helpers give tests that one row cheaply.
//
// Seeded ids are tracked per test-file process (Vitest isolates modules per
// file), so cleanupSeededUsers() in an afterEach/afterAll deletes exactly the
// rows this file created — and the cascade takes their owned content with them,
// leaving the shared compose DB as clean as we found it.
const seeded = new Set<string>();

// Inserts a real better-auth `user` row and returns its id (a fresh synthetic
// `test-…` id by default). The email column is UNIQUE, so it is derived from
// the id, which is itself unique. Idempotent: re-seeding the same id is a
// no-op, so it is safe to call defensively.
export async function seedUser(
  id: string = `test-${randomUUID()}`,
  overrides: { name?: string; email?: string; role?: string } = {},
): Promise<string> {
  await db
    .insert(user)
    .values({
      id,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `${id}@example.com`,
      role: overrides.role ?? "client",
    })
    .onConflictDoNothing();
  seeded.add(id);
  return id;
}

// Deletes every user seeded by this file so far; owned content cascades away
// with each row. Call from afterEach (or afterAll) to keep the compose DB tidy.
export async function cleanupSeededUsers(): Promise<void> {
  if (seeded.size === 0) return;
  const ids = [...seeded];
  seeded.clear();
  await db.delete(user).where(inArray(user.id, ids));
}
