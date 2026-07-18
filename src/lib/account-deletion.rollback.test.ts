import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, user, account } from "@/db/schema";
import { hashPassword } from "./password";
import { encryptText } from "@/lib/crypto/envelope";

vi.mock("@/lib/crypto/user-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto/user-keys")>()),
  shredUserKey: vi.fn().mockRejectedValue(new Error("injected shred failure")),
}));

import { getOrCreateUserDek } from "@/lib/crypto/user-keys";
import { deleteAccount } from "./account-deletion";

// Integration test — requires `docker compose up --detach` and migrations.
describe("deleteAccount transactionality", () => {
  it("a failure mid-transaction leaves the account fully intact", async () => {
    const userId = `test-${randomUUID()}`;
    const password = "delete-me-please-1";
    await db.insert(user).values({ id: userId, name: "Survivor", email: `${userId}@example.com` });
    await db.insert(account).values({
      id: randomUUID(), userId, accountId: userId, providerId: "credential",
      password: await hashPassword(password),
    });
    const dek = await getOrCreateUserDek(userId);
    await db.insert(conversations).values({ userId, titleCiphertext: encryptText(dek, "t") });

    await expect(deleteAccount(userId, password)).rejects.toThrow("injected shred failure");

    expect(await db.select().from(user).where(eq(user.id, userId))).toHaveLength(1);
    expect(await db.select().from(conversations).where(eq(conversations.userId, userId))).toHaveLength(1);
  });
});
