import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getOrCreateUserDek, shredUserKey } from "./user-keys";
import { db } from "@/db";
import { userKeys } from "@/db/schema";
import { eq } from "drizzle-orm";

// Integration test — requires `docker compose up --detach` and migrations.
describe("user key lifecycle", () => {
  let userId: string;
  beforeEach(() => {
    userId = `test-${randomUUID()}`;
  });

  it("creates a DEK on first use and returns the same one after", async () => {
    const first = await getOrCreateUserDek(userId);
    const second = await getOrCreateUserDek(userId);
    expect(first.length).toBe(32);
    expect(first.equals(second)).toBe(true);
  });

  it("stores only the wrapped DEK, never the raw key", async () => {
    const dek = await getOrCreateUserDek(userId);
    const [row] = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
    expect(row.wrappedDek).not.toContain(dek.toString("base64"));
  });

  it("shredding the key makes it unrecoverable", async () => {
    await getOrCreateUserDek(userId);
    await shredUserKey(userId);
    const rows = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
    expect(rows).toHaveLength(0);
  });
});
