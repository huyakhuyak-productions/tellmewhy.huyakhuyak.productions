import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { mockEmailOutbox } from "./email";
import { db } from "@/db";
import { session, user } from "@/db/schema";

// Integration test — requires `docker compose up --detach` and migrations.
describe("password reset", () => {
  let email: string;
  const password = "orig-password-123";

  beforeEach(async () => {
    mockEmailOutbox.length = 0;
    email = `test-${randomUUID()}@example.com`;
    await auth.api.signUpEmail({ body: { email, password, name: "Reset Tester" } });
  });

  async function requestReset(forEmail: string) {
    await auth.api.requestPasswordReset({
      body: { email: forEmail, redirectTo: "/reset-password" },
    });
  }

  function tokenFromOutbox(): string {
    const text = mockEmailOutbox.at(-1)!.text;
    const match = text.match(/reset-password\/([^?\s]+)/);
    expect(match).not.toBeNull();
    return match![1];
  }

  it("emails a link whose token resets the password", async () => {
    await requestReset(email);
    expect(mockEmailOutbox).toHaveLength(1);
    expect(mockEmailOutbox[0].to).toBe(email);

    await auth.api.resetPassword({
      body: { newPassword: "brand-new-password-1", token: tokenFromOutbox() },
    });

    await expect(
      auth.api.signInEmail({ body: { email, password: "brand-new-password-1" } }),
    ).resolves.toBeTruthy();
    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toThrow();
  });

  it("revokes every existing session on reset", async () => {
    await auth.api.signInEmail({ body: { email, password } });
    const [u] = await db.select().from(user).where(eq(user.email, email));
    const before = await db.select().from(session).where(eq(session.userId, u.id));
    expect(before.length).toBeGreaterThan(0);

    await requestReset(email);
    await auth.api.resetPassword({
      body: { newPassword: "brand-new-password-2", token: tokenFromOutbox() },
    });

    const after = await db.select().from(session).where(eq(session.userId, u.id));
    expect(after).toHaveLength(0);
  });

  it("stays silent for an unknown email (no throw, no email)", async () => {
    await expect(requestReset(`test-${randomUUID()}@example.com`)).resolves.toBeUndefined();
    expect(mockEmailOutbox).toHaveLength(0);
  });

  it("rejects a reused token", async () => {
    await requestReset(email);
    const token = tokenFromOutbox();
    await auth.api.resetPassword({ body: { newPassword: "brand-new-password-3", token } });
    await expect(
      auth.api.resetPassword({ body: { newPassword: "brand-new-password-4", token } }),
    ).rejects.toThrow();
  });
});
