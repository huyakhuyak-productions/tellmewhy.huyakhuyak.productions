import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { getOrCreateUserDek, shredUserKey, KeyShreddedError } from "./user-keys";
import { getKeyProvider } from "./key-provider";
import { withRequestScope } from "@/lib/request-scope";
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

  it("shredding tombstones the key: wrapped DEK gone, shredded_at stamped", async () => {
    await getOrCreateUserDek(userId);
    await shredUserKey(userId);
    const [row] = await db.select().from(userKeys).where(eq(userKeys.userId, userId));
    expect(row.wrappedDek).toBeNull();
    expect(row.shreddedAt).not.toBeNull();
  });

  it("never re-mints a DEK for a shredded user", async () => {
    await getOrCreateUserDek(userId);
    await shredUserKey(userId);
    await expect(getOrCreateUserDek(userId)).rejects.toBeInstanceOf(KeyShreddedError);
  });

  it("tombstones even a user who never had a key", async () => {
    await shredUserKey(userId);
    await expect(getOrCreateUserDek(userId)).rejects.toBeInstanceOf(KeyShreddedError);
  });

  describe("per-request memoization", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("unwraps once per request scope no matter how many callers ask", async () => {
      await getOrCreateUserDek(userId); // seed the row outside any scope
      const unwrapSpy = vi.spyOn(getKeyProvider(), "unwrapDek");

      await withRequestScope(async () => {
        await getOrCreateUserDek(userId); // saveMessage (client turn)
        await getOrCreateUserDek(userId); // loadMessages
        await getOrCreateUserDek(userId); // saveMessage (AI reply)
        await getOrCreateUserDek(userId); // renameConversation
      });

      expect(unwrapSpy).toHaveBeenCalledTimes(1);
    });

    // The security property the memoization must never trade away: a raw DEK
    // must not outlive the request that decrypted it. Two separate scopes —
    // standing in for two separate HTTP requests — must each pay for their
    // own unwrap.
    it("does not share the cached DEK across two different request scopes", async () => {
      await getOrCreateUserDek(userId); // seed the row outside any scope
      const unwrapSpy = vi.spyOn(getKeyProvider(), "unwrapDek");

      await withRequestScope(() => getOrCreateUserDek(userId));
      await withRequestScope(() => getOrCreateUserDek(userId));

      expect(unwrapSpy).toHaveBeenCalledTimes(2);
    });

    it("does not cache at all when called outside any request scope", async () => {
      await getOrCreateUserDek(userId); // seed the row outside any scope
      const unwrapSpy = vi.spyOn(getKeyProvider(), "unwrapDek");

      await getOrCreateUserDek(userId);
      await getOrCreateUserDek(userId);

      expect(unwrapSpy).toHaveBeenCalledTimes(2);
    });
  });
});
