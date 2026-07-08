import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";

// Resolve a set of user ids to their display names in one query. Used to label
// therapist-authored messages ("<name> — your therapist") by their authorId,
// which stays correct even after a link is revoked (the messages remain in the
// thread; only the live grant goes away). Ids with no matching user are simply
// absent from the map — the caller decides on a fallback.
export async function getUserDisplayNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter((id) => id.length > 0);
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}
