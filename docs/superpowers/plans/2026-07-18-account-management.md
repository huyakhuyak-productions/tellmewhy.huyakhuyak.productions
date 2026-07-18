# Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-serve account deletion (crypto-shred + purge, therapist farewell state) and email-based password recovery, plus the `/account` surface both need (sign-out, change password, delete).

**Architecture:** Deletion is a single-transaction domain function (`src/lib/account-deletion.ts`) behind a thin `DELETE /api/account` route; shredding becomes a tombstone in `user_keys` so nothing can ever re-key a deleted user. Password reset uses better-auth's built-in flow, enabled by a `sendResetPassword` config hook that calls a zero-dependency Resend `fetch` client (`src/lib/email.ts`) with a console-mock mode for dev/test. The farewell state lives on kept `therapist_links` rows (three new columns), name-snapshot encrypted under the survivor's DEK.

**Tech Stack:** Next.js (App Router) · Bun · Drizzle + Postgres 17 (docker) · better-auth 1.6.22 · Vitest integration tests against the docker DB · Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-18-account-management-design.md` — read it first.

## Global Constraints

- **No new packages.** Resend is called with plain `fetch`. Email transport mock in dev/test.
- **TDD every lib/route change**; tests are integration tests against the docker DB (`docker compose up --detach` + `bun run db:migrate` first; Vitest deliberately does NOT load `.env.local` — `src/test/setup.ts` points at the docker DB).
- **Key-ownership law:** the departure name snapshot is encrypted under the **survivor's** DEK. Prove cross-key non-decryption in tests for anything new.
- **Audit rows are ids + times only, never content**, and are never purged.
- **Main is the only branch.** Gitmoji commits, one behavior each, long-form flags, git one command at a time. Run `bunx tsc --noEmit && bun run lint` before every commit; trust those, not IDE squiggles.
- **All UI work goes through the `frontend-design`, `make-interfaces-feel-better`, `transitions-dev` skills** (standing directive). UI tasks below give contracts, not pixel decisions.
- **Voice:** calm, honest, never coercive. Crisis = warm amber, never red. Deletion copy states exactly what is lost, without drama. 429 copy style: "Slow down a little".
- Agents' tools are blocked from any `.env*` path — never read or echo those files.
- Never mention other projects in commits/comments.

---

### Task 1: Schema — tombstone columns, departure columns, audit action

**Files:**
- Modify: `src/db/schema.ts:22-27` (userKeys), `:100-107` (auditActionEnum), `:109-131` (therapistLinks)
- Create: `drizzle/0015_*.sql` (generated — never hand-write)

**Interfaces:**
- Produces: `userKeys.wrappedDek` now nullable; `userKeys.shreddedAt: timestamp | null`; `therapistLinks.departedAt`, `therapistLinks.departedNameCiphertext`, `therapistLinks.departureAcknowledgedAt`; audit action `"account_deleted"`.

- [ ] **Step 1: Edit `userKeys`** — replace the table (and its comment) with:

```ts
// One wrapped DEK per user. Shredding NULLs wrapped_dek and stamps
// shredded_at — the row becomes a tombstone that permanently blocks
// re-creating a key for this user (see user-keys.ts). The tombstone, not
// row deletion, is the crypto-shred.
export const userKeys = pgTable("user_keys", {
  userId: text("user_id").primaryKey(),
  wrappedDek: text("wrapped_dek"),
  shreddedAt: timestamp("shredded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Add `"account_deleted"`** to `auditActionEnum` (after `"mood_trend_viewed"`).

- [ ] **Step 3: Add three columns to `therapistLinks`** after `moodSharedAt`:

```ts
    // Set when a party deleted their account (vs. plain revocation). The
    // name snapshot is encrypted under the SURVIVING party's DEK — from the
    // moment of deletion it is the survivor's record, like their notes.
    departedAt: timestamp("departed_at"),
    departedNameCiphertext: text("departed_name_ciphertext"),
    departureAcknowledgedAt: timestamp("departure_acknowledged_at"),
```

- [ ] **Step 4: Generate + inspect.** Run `bun run db:generate`. Inspect the new `drizzle/0015_*.sql`: expect `ALTER TABLE "user_keys" ALTER COLUMN "wrapped_dek" DROP NOT NULL;`, `ADD COLUMN "shredded_at"`, three `ADD COLUMN`s on `therapist_links`, and `ALTER TYPE "public"."audit_action" ADD VALUE 'account_deleted';`. No DROPs of any kind — if a DROP appears, stop and investigate.
- [ ] **Step 5: Migrate.** Run `bun run db:migrate`. Expected: applies cleanly.
- [ ] **Step 6: Gates.** `bunx tsc --noEmit && bun run lint` → clean. `bun run test` → the existing suite passes (the shred test still passes: rows-after-shred is asserted in Task 2's rewrite; today's test deletes rows and still does).

Note: today's `shredUserKey` still row-deletes — that changes in Task 2; this task only makes the columns exist. The existing test asserting 0 rows after shred remains green.

- [ ] **Step 7: Commit** — `🗃️ Give user_keys a shred tombstone and links a departure marker`

---

### Task 2: Tombstone shred + `KeyShreddedError`

**Files:**
- Modify: `src/db/index.ts` (add the `DbExecutor` type)
- Modify: `src/lib/crypto/user-keys.ts` (whole file below)
- Test: `src/lib/crypto/user-keys.test.ts`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `shredUserKey(userId: string, executor?: DbExecutor): Promise<void>` (tombstone upsert, callable inside a transaction); `KeyShreddedError extends Error`; `getOrCreateUserDek` unchanged signature but throws `KeyShreddedError` on tombstoned users; `DbExecutor` exported from `@/db` (either the `db` singleton or a transaction handle — later tasks pass transactions into shared write helpers).

Add to `src/db/index.ts`:

```ts
// Either the shared db singleton or a transaction handle — write helpers
// accept this so a caller can make them part of a larger transaction.
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
```

- [ ] **Step 1: Write the failing tests** — replace the "shredding" test and add tombstone tests in `user-keys.test.ts`:

```ts
import { getOrCreateUserDek, shredUserKey, KeyShreddedError } from "./user-keys";

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
```

- [ ] **Step 2: Run to verify failure.** `bun run test src/lib/crypto/user-keys.test.ts` — expect FAIL (no `KeyShreddedError` export; shred still deletes).
- [ ] **Step 3: Implement** — replace `src/lib/crypto/user-keys.ts` below the memoization block with:

```ts
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
```

(`getOrCreateUserDek` and the memoization comment stay exactly as they are. Change the
file's first import to `import { db, type DbExecutor } from "@/db";`.)

- [ ] **Step 4: Run tests.** `bun run test src/lib/crypto/user-keys.test.ts` → all pass, including the untouched memoization suite.
- [ ] **Step 5: Full gates.** `bun run test && bunx tsc --noEmit && bun run lint` — the whole suite must stay green (resilient readers treat `KeyShreddedError` like any decrypt failure; nothing else calls `shredUserKey`).
- [ ] **Step 6: Commit** — `🔒️ Block re-keying of shredded users with a tombstone`

---

### Task 3: Email module (Resend via fetch, mock in dev/test)

**Files:**
- Create: `src/lib/email.ts`
- Test: `src/lib/email.test.ts`

**Interfaces:**
- Produces: `sendEmail(message: { to: string; subject: string; text: string }): Promise<void>`; `mockEmailOutbox: Array<{ to: string; subject: string; text: string }>` (test/dev hook, real mode never touches it).

- [ ] **Step 1: Write the failing tests** — `src/lib/email.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockEmailOutbox, sendEmail } from "./email";

describe("sendEmail", () => {
  beforeEach(() => {
    mockEmailOutbox.length = 0;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("without an API key, records to the mock outbox and sends nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await sendEmail({ to: "a@example.com", subject: "Hello", text: "Body" });
    expect(mockEmailOutbox).toHaveLength(1);
    expect(mockEmailOutbox[0]).toEqual({ to: "a@example.com", subject: "Hello", text: "Body" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with an API key, POSTs to Resend and skips the outbox", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "tellmewhy <no-reply@tellmewhy.huyakhuyak.productions>";
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await sendEmail({ to: "a@example.com", subject: "Hello", text: "Body" });
    expect(mockEmailOutbox).toHaveLength(0);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body)).toMatchObject({ to: "a@example.com", subject: "Hello" });
  });

  it("throws on a non-2xx response without leaking recipient or body", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "no-reply@example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));
    const attempt = sendEmail({ to: "secret@example.com", subject: "S", text: "T" });
    await expect(attempt).rejects.toThrow(/403/);
    await expect(attempt).rejects.not.toThrow(/secret@example.com/);
  });

  it("refuses mock mode in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(sendEmail({ to: "a@example.com", subject: "S", text: "T" })).rejects.toThrow(
      /RESEND_API_KEY/,
    );
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Run to verify failure.** `bun run test src/lib/email.test.ts` — FAIL (module doesn't exist).
- [ ] **Step 3: Implement** — `src/lib/email.ts`:

```ts
// Transactional email via Resend's plain HTTP API — deliberately no SDK
// (no-new-packages rule). Without RESEND_API_KEY (dev, test) it records to
// an in-memory outbox and logs, mirroring the AI_MOCK posture, and refuses
// to run mocked in production. Real mode never logs recipient or body; a
// failure surfaces only the HTTP status.
export type EmailMessage = { to: string; subject: string; text: string };

// Dev/test hook only — real mode never touches it.
export const mockEmailOutbox: EmailMessage[] = [];

export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set — refusing to mock email in production");
    }
    mockEmailOutbox.push(message);
    // Dev needs the body (it carries the reset link); mock mode only.
    console.log(`[email mock] subject="${message.subject}"\n${message.text}`);
    return;
  }
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
  });
  if (!response.ok) throw new Error(`email send failed: HTTP ${response.status}`);
}
```

- [ ] **Step 4: Run tests.** `bun run test src/lib/email.test.ts` → PASS.
- [ ] **Step 5: Gates + commit** — `bunx tsc --noEmit && bun run lint` → `✨ Send transactional email through Resend, mocked in dev`

---

### Task 4: Password reset flow (better-auth config)

**Files:**
- Modify: `src/lib/auth.ts`
- Test: `src/lib/password-reset.test.ts` (new)

**Interfaces:**
- Consumes: `sendEmail` + `mockEmailOutbox` (Task 3).
- Produces: live better-auth endpoints `/api/auth/request-password-reset` and `/api/auth/reset-password` (client proxy methods `authClient.requestPasswordReset({ email, redirectTo })` and `authClient.resetPassword({ newPassword, token })`); all sessions revoked on successful reset.

- [ ] **Step 1: Write the failing tests** — `src/lib/password-reset.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure.** `bun run test src/lib/password-reset.test.ts` — FAIL ("Reset password isn't enabled").
- [ ] **Step 3: Implement** — in `src/lib/auth.ts`, import `sendEmail` and extend the config:

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { sendEmail } from "./email";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    password: { hash: hashPassword, verify: verifyPassword },
    // A reset often means "someone may know my password" — leave no session standing.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Link only — no name echoes, no content. The email inherently tells
      // the inbox owner this address has an account; it must tell them
      // nothing else.
      await sendEmail({
        to: user.email,
        subject: "Reset your tellmewhy password",
        text: [
          "Someone asked to reset the password for this tellmewhy account.",
          "",
          `If it was you, follow this link within the next hour:`,
          url,
          "",
          "If it wasn't you, you can ignore this — nothing has changed.",
        ].join("\n"),
      });
    },
  },
  // better-auth's limiter is production-only by default (dev/test stay
  // unlimited); this rule tightens the one endpoint that sends email.
  rateLimit: {
    customRules: {
      "/request-password-reset": { window: 900, max: 5 },
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "client", input: false },
    },
  },
});
```

- [ ] **Step 4: Run tests.** `bun run test src/lib/password-reset.test.ts` → PASS.
- [ ] **Step 5: Gates + commit** — full `bun run test && bunx tsc --noEmit && bun run lint` → `✨ Let a forgotten password be reset by email`

---

### Task 5: Account deletion domain function (the centerpiece)

**Files:**
- Create: `src/lib/account-deletion.ts`
- Modify: `src/lib/audit.ts:28-30` (`recordAudit` gains an executor param — the house rule says every audit write goes through it, including transactional ones)
- Test: `src/lib/account-deletion.test.ts`, `src/lib/account-deletion.rollback.test.ts`

**Interfaces:**
- Consumes: `shredUserKey(userId, tx)` + `KeyShreddedError` (Task 2); `DbExecutor` from `@/db` (Task 2); `verifyPassword` (`src/lib/password.ts:15`); `encryptText(dek, plaintext)` / `decryptText(dek, payload)` (`src/lib/crypto/envelope.ts`); `getOrCreateUserDek`; `ValidationError`/`NotFoundError` (`src/lib/errors.ts`); Task 1 columns + `"account_deleted"` audit action.
- Produces: `deleteAccount(userId: string, password: string): Promise<void>` — throws `NotFoundError` (no such user), `ValidationError` ("Incorrect password"). `recordAudit(event: AuditEvent, executor?: DbExecutor)` (default `db`, fully backward-compatible).

`recordAudit` becomes:

```ts
export async function recordAudit(event: AuditEvent, executor: DbExecutor = db): Promise<void> {
  await executor.insert(auditEvents).values(event);
}
```

(with `import type { DbExecutor } from "@/db";` added — no call-site changes needed.)

- [ ] **Step 1: Write the failing tests** — `src/lib/account-deletion.test.ts`. Seed a client + linked therapist entirely through raw inserts (the synthetic `test-…` id convention), then assert the full contract:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { deleteAccount } from "./account-deletion";
import { hashPassword } from "./password";
import { ValidationError, NotFoundError } from "./errors";
import { getOrCreateUserDek, KeyShreddedError } from "@/lib/crypto/user-keys";
import { decryptText, encryptText } from "@/lib/crypto/envelope";
import { db } from "@/db";
import {
  account, auditEvents, conversations, exerciseEntries, exercises, folders,
  messages, moodCheckins, notes, selfNotes, session, sharingGrants,
  therapistLinks, user, userKeys,
} from "@/db/schema";

// Integration test — requires `docker compose up --detach` and migrations.
describe("deleteAccount", () => {
  const password = "delete-me-please-1";
  let clientId: string;
  let therapistId: string;
  let linkId: string;

  async function seedUser(id: string, role: string, name: string) {
    await db.insert(user).values({ id, name, email: `${id}@example.com`, role });
    await db.insert(account).values({
      id: randomUUID(), userId: id, accountId: id, providerId: "credential",
      password: await hashPassword(password),
    });
    await db.insert(session).values({
      id: randomUUID(), userId: id, token: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  }

  beforeEach(async () => {
    clientId = `test-${randomUUID()}`;
    therapistId = `test-${randomUUID()}`;
    await seedUser(clientId, "client", "Departing Client");
    await seedUser(therapistId, "therapist", "Their Therapist");

    const clientDek = await getOrCreateUserDek(clientId);
    const therapistDek = await getOrCreateUserDek(therapistId);

    const [link] = await db.insert(therapistLinks).values({
      clientId, therapistId, initiatedBy: "client",
      inviteTokenHash: randomUUID(), status: "active", acceptedAt: new Date(),
    }).returning();
    linkId = link.id;

    const [conv] = await db.insert(conversations).values({
      userId: clientId, titleCiphertext: encryptText(clientDek, "t"),
    }).returning();
    await db.insert(messages).values({
      conversationId: conv.id, sender: "client", ciphertext: encryptText(clientDek, "hello"),
    });
    await db.insert(sharingGrants).values({ linkId, conversationId: conv.id });
    await db.insert(folders).values({ userId: clientId, nameCiphertext: encryptText(clientDek, "f") });
    await db.insert(moodCheckins).values({
      userId: clientId, day: "2026-07-18", payloadCiphertext: encryptText(clientDek, "{}"),
    });
    await db.insert(selfNotes).values({ userId: clientId, bodyCiphertext: encryptText(clientDek, "n") });
    const [exercise] = await db.insert(exercises).values({
      linkId, clientId, type: "thought_record",
      instructionCiphertext: encryptText(clientDek, "i"),
    }).returning();
    await db.insert(exerciseEntries).values({
      userId: clientId, exerciseId: exercise.id, payloadCiphertext: encryptText(clientDek, "{}"),
    });
    await db.insert(notes).values({
      linkId, kind: "private", bodyCiphertext: encryptText(therapistDek, "my note"),
    });
  });

  it("rejects a wrong password and deletes nothing", async () => {
    await expect(deleteAccount(clientId, "wrong-password-1")).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(user).where(eq(user.id, clientId))).toHaveLength(1);
    expect(await db.select().from(conversations).where(eq(conversations.userId, clientId))).toHaveLength(1);
  });

  it("404s for a user that does not exist", async () => {
    await expect(deleteAccount(`test-${randomUUID()}`, password)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("purges every owned row, shreds the key, and removes the account", async () => {
    await deleteAccount(clientId, password);

    for (const [table, column] of [
      [conversations, conversations.userId], [folders, folders.userId],
      [moodCheckins, moodCheckins.userId], [selfNotes, selfNotes.userId],
      [exerciseEntries, exerciseEntries.userId],
    ] as const) {
      expect(await db.select().from(table).where(eq(column, clientId))).toHaveLength(0);
    }
    expect(await db.select().from(exercises).where(eq(exercises.clientId, clientId))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, clientId))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, clientId))).toHaveLength(0);
    expect(await db.select().from(account).where(eq(account.userId, clientId))).toHaveLength(0);

    const [keyRow] = await db.select().from(userKeys).where(eq(userKeys.userId, clientId));
    expect(keyRow.wrappedDek).toBeNull();
    await expect(getOrCreateUserDek(clientId)).rejects.toBeInstanceOf(KeyShreddedError);
  });

  it("keeps the link row revoked with a departure marker, grants gone, notes intact", async () => {
    await deleteAccount(clientId, password);

    const [link] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(link.status).toBe("revoked");
    expect(link.departedAt).not.toBeNull();
    expect(link.departureAcknowledgedAt).toBeNull();
    expect(await db.select().from(sharingGrants).where(eq(sharingGrants.linkId, linkId))).toHaveLength(0);
    expect(await db.select().from(notes).where(eq(notes.linkId, linkId))).toHaveLength(1);
  });

  it("snapshots the departing name so only the survivor's DEK opens it", async () => {
    await deleteAccount(clientId, password);
    const [link] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    const therapistDek = await getOrCreateUserDek(therapistId);
    expect(decryptText(therapistDek, link.departedNameCiphertext!)).toBe("Departing Client");

    // Cross-key proof: any other key must fail to open it.
    const strangerDek = await getOrCreateUserDek(`test-${randomUUID()}`);
    expect(() => decryptText(strangerDek, link.departedNameCiphertext!)).toThrow();
  });

  it("writes one account_deleted audit line per partnered link, actor-attributed", async () => {
    await deleteAccount(clientId, password);
    const rows = await db.select().from(auditEvents).where(
      and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "account_deleted")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].therapistId).toBe(therapistId);
    expect(rows[0].actorId).toBe(clientId);
  });

  it("deleting a therapist purges their notes and markers but never client homework", async () => {
    await deleteAccount(therapistId, password);

    expect(await db.select().from(notes).where(eq(notes.linkId, linkId))).toHaveLength(0);
    expect(await db.select().from(exercises).where(eq(exercises.clientId, clientId))).toHaveLength(1);
    expect(await db.select().from(conversations).where(eq(conversations.userId, clientId))).toHaveLength(1);

    const [link] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(link.status).toBe("revoked");
    expect(link.departedAt).not.toBeNull();
    const clientDek = await getOrCreateUserDek(clientId);
    expect(decryptText(clientDek, link.departedNameCiphertext!)).toBe("Their Therapist");
  });

  it("writes an unpartnered self line when no links exist", async () => {
    const loner = `test-${randomUUID()}`;
    await seedUser(loner, "client", "Loner");
    await deleteAccount(loner, password);
    const rows = await db.select().from(auditEvents).where(
      and(eq(auditEvents.clientId, loner), eq(auditEvents.action, "account_deleted")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].therapistId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.** `bun run test src/lib/account-deletion.test.ts` — FAIL (module doesn't exist).
- [ ] **Step 3: Implement** — `src/lib/account-deletion.ts`:

```ts
// Self-serve account deletion: the product's one true delete. Everything
// happens in a single transaction — audit lines, link closure + departure
// markers, the full purge of owned rows, the key tombstone, and the user
// row itself (session + account cascade at the DB). Partner-owned records
// (their notes, the audit trail, the kept link row) survive on purpose;
// see the account-management spec.
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import {
  account, conversations, exerciseEntries, exercises, folders,
  moodCheckins, notes, reviewMarkers, selfNotes, sharingGrants,
  therapistLinks, user,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { encryptText } from "@/lib/crypto/envelope";
import { getOrCreateUserDek, shredUserKey } from "@/lib/crypto/user-keys";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";

export async function deleteAccount(userId: string, password: string): Promise<void> {
  const [userRow] = await db.select().from(user).where(eq(user.id, userId));
  if (!userRow) throw new NotFoundError("User not found");

  const [credential] = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
  const ok = credential?.password
    ? await verifyPassword({ hash: credential.password, password })
    : false;
  if (!ok) throw new ValidationError("Incorrect password");

  const links = await db
    .select()
    .from(therapistLinks)
    .where(or(eq(therapistLinks.clientId, userId), eq(therapistLinks.therapistId, userId)));
  const linkIds = links.map((l) => l.id);
  const partnered = links.filter((l) => l.clientId !== null && l.therapistId !== null);

  // The departing name, sealed under each SURVIVOR's DEK before the
  // transaction — it is the survivor's record from here on (key-ownership
  // law), and their key must exist for that to hold.
  const snapshots = await Promise.all(
    partnered.map(async (link) => {
      const partnerId = link.clientId === userId ? link.therapistId! : link.clientId!;
      const partnerDek = await getOrCreateUserDek(partnerId);
      return { linkId: link.id, ciphertext: encryptText(partnerDek, userRow.name) };
    }),
  );

  const asTherapistLinkIds = links.filter((l) => l.therapistId === userId).map((l) => l.id);

  await db.transaction(async (tx) => {
    if (partnered.length > 0) {
      for (const link of partnered) {
        await recordAudit(
          {
            clientId: link.clientId!,
            therapistId: link.therapistId,
            actorId: userId,
            action: "account_deleted",
          },
          tx,
        );
      }
    } else {
      await recordAudit(
        { clientId: userId, therapistId: null, actorId: userId, action: "account_deleted" },
        tx,
      );
    }

    // Close every link but KEEP the rows — deleting them would cascade the
    // survivor's notes away. Grants die with the closure, like a manual revoke.
    if (linkIds.length > 0) {
      await tx
        .update(therapistLinks)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            inArray(therapistLinks.id, linkIds),
            inArray(therapistLinks.status, ["invited", "active"]),
          ),
        );
      await tx.delete(sharingGrants).where(inArray(sharingGrants.linkId, linkIds));
    }
    for (const snapshot of snapshots) {
      await tx
        .update(therapistLinks)
        .set({ departedAt: new Date(), departedNameCiphertext: snapshot.ciphertext })
        .where(eq(therapistLinks.id, snapshot.linkId));
    }

    // The purge. Messages, digests, grants and markers cascade off
    // conversations; a deleting therapist's notes and markers hang off KEPT
    // link rows, so they go explicitly. Audit rows are never purged.
    await tx.delete(conversations).where(eq(conversations.userId, userId));
    await tx.delete(folders).where(eq(folders.userId, userId));
    await tx.delete(moodCheckins).where(eq(moodCheckins.userId, userId));
    await tx.delete(selfNotes).where(eq(selfNotes.userId, userId));
    await tx.delete(exerciseEntries).where(eq(exerciseEntries.userId, userId));
    await tx.delete(exercises).where(eq(exercises.clientId, userId));
    if (asTherapistLinkIds.length > 0) {
      await tx.delete(notes).where(inArray(notes.linkId, asTherapistLinkIds));
      await tx.delete(reviewMarkers).where(inArray(reviewMarkers.linkId, asTherapistLinkIds));
    }

    await shredUserKey(userId, tx);
    // Last: the account itself. session + account rows cascade — every
    // device is signed out the moment this commits.
    await tx.delete(user).where(eq(user.id, userId));
  });
}
```

- [ ] **Step 4: Run tests.** `bun run test src/lib/account-deletion.test.ts` → all pass.
- [ ] **Step 5: Write the rollback test** — `src/lib/account-deletion.rollback.test.ts` (its own file: the module mock must not leak into the main suite). Proves the spec's "a failure mid-purge leaves the account intact":

```ts
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
```

Run: `bun run test src/lib/account-deletion.rollback.test.ts` → PASS (the purge rolled back).

- [ ] **Step 6: Full gates.** `bun run test && bunx tsc --noEmit && bun run lint` → green.
- [ ] **Step 7: Commit** — `✨ Let a user delete their account: shred the key, purge the rows`

---

### Task 6: `DELETE /api/account` route + rate limiter

**Files:**
- Modify: `src/lib/rate-limit.ts` (append)
- Create: `src/app/api/account/route.ts`
- Test: `src/lib/rate-limit.test.ts` — ONLY if that file already exists and has per-limiter cases; otherwise the limiter is covered by the route's e2e + the existing class tests.

**Interfaces:**
- Consumes: `deleteAccount` (Task 5), `ValidationError`/`NotFoundError`, `auth.api.getSession`.
- Produces: `DELETE /api/account` with JSON body `{ password: string }` → `204` on success, `400` (bad input / wrong password), `401`, `404`, `429`. Export `accountDeleteRateLimiter`.

- [ ] **Step 1: Append the limiter** to `src/lib/rate-limit.ts`:

```ts
// Account deletion re-verifies the password, which makes the endpoint a
// credential-guessing surface — the tightest bucket here, keyed by userId.
// Three honest attempts per window is plenty for a human mistyping.
export const accountDeleteRateLimiter = new RateLimiter({ capacity: 3, refillWindowMs: 15 * 60 * 1000 });
```

- [ ] **Step 2: Create the route** — `src/app/api/account/route.ts` (template: `src/app/api/links/[linkId]/route.ts`):

```ts
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { deleteAccount } from "@/lib/account-deletion";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { accountDeleteRateLimiter } from "@/lib/rate-limit";

const bodySchema = z.object({ password: z.string().min(1) });

export async function DELETE(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!accountDeleteRateLimiter.consume(session.user.id)) {
    return Response.json({ error: "Slow down a little" }, { status: 429 });
  }
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    await deleteAccount(session.user.id, body.data.password);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
```

- [ ] **Step 3: Gates.** `bunx tsc --noEmit && bun run lint && bun run test` → green (route behavior itself is exercised by the Task 12 e2e; the domain contract is Task 5's suite).
- [ ] **Step 4: Commit** — `✨ Expose account deletion at DELETE /api/account, rate-limited`

---

### Task 7: Departure listing + acknowledgment (lib + route)

**Files:**
- Modify: `src/lib/therapist-links.ts` (append)
- Create: `src/app/api/links/[linkId]/acknowledge-departure/route.ts`
- Test: `src/lib/therapist-links.test.ts` (append; if link tests live elsewhere, follow that file)

**Interfaces:**
- Consumes: Task 1 columns; `decryptText`; `getOrCreateUserDek`; `NotFoundError`.
- Produces:
  - `type Departure = { linkId: string; name: string | null; departedAt: Date }`
  - `listDepartures(forUserId: string): Promise<Departure[]>` — links where the caller is either party, `departedAt` set, unacknowledged; name decrypted with the CALLER's DEK, resilient (`null` on any decrypt failure).
  - `acknowledgeDeparture(linkId: string, byUserId: string): Promise<void>` — stamps `departureAcknowledgedAt`; `NotFoundError` if the caller isn't a party, no departure, or already acknowledged.
  - `POST /api/links/[linkId]/acknowledge-departure` → `204` / `401` / `400` / `404`.

- [ ] **Step 1: Write the failing tests** (append to the link-lifecycle test file):

```ts
describe("departures", () => {
  it("lists an unacknowledged departure with the name only the survivor can read", async () => {
    // Seed: active link, then simulate departure the way deleteAccount does:
    const therapistDek = await getOrCreateUserDek(therapistId);
    await db.update(therapistLinks).set({
      status: "revoked", revokedAt: new Date(), departedAt: new Date(),
      departedNameCiphertext: encryptText(therapistDek, "Departed Client"),
    }).where(eq(therapistLinks.id, linkId));

    const departures = await listDepartures(therapistId);
    expect(departures).toHaveLength(1);
    expect(departures[0]).toMatchObject({ linkId, name: "Departed Client" });

    // The other party of some other link — or anyone else — sees nothing.
    expect(await listDepartures(`test-${randomUUID()}`)).toHaveLength(0);
  });

  it("falls back to a null name on a corrupt snapshot instead of failing the list", async () => {
    await db.update(therapistLinks).set({
      status: "revoked", departedAt: new Date(), departedNameCiphertext: "v1.not.real.ciphertext",
    }).where(eq(therapistLinks.id, linkId));
    const departures = await listDepartures(therapistId);
    expect(departures).toHaveLength(1);
    expect(departures[0].name).toBeNull();
  });

  it("acknowledging removes it from the list; repeats and strangers 404", async () => {
    await db.update(therapistLinks).set({
      status: "revoked", departedAt: new Date(),
    }).where(eq(therapistLinks.id, linkId));

    await expect(acknowledgeDeparture(linkId, `test-${randomUUID()}`)).rejects.toBeInstanceOf(NotFoundError);
    await acknowledgeDeparture(linkId, therapistId);
    expect(await listDepartures(therapistId)).toHaveLength(0);
    await expect(acknowledgeDeparture(linkId, therapistId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

(Reuse that file's existing seeding helpers for `clientId`/`therapistId`/`linkId`; mirror its import style.)

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement** — append to `src/lib/therapist-links.ts`:

```ts
// A departure is a link whose other party deleted their account. The name
// snapshot was sealed under the CALLER's DEK at deletion time (it's the
// survivor's record); a decrypt failure degrades to a nameless card, never
// a failed list — one bad ciphertext must never take the rest down.
export type Departure = { linkId: string; name: string | null; departedAt: Date };

export async function listDepartures(forUserId: string): Promise<Departure[]> {
  const rows = await db
    .select()
    .from(therapistLinks)
    .where(
      and(
        or(eq(therapistLinks.clientId, forUserId), eq(therapistLinks.therapistId, forUserId)),
        isNotNull(therapistLinks.departedAt),
        isNull(therapistLinks.departureAcknowledgedAt),
      ),
    );
  if (rows.length === 0) return [];
  const dek = await getOrCreateUserDek(forUserId);
  return rows.map((row) => {
    let name: string | null = null;
    if (row.departedNameCiphertext) {
      try {
        name = decryptText(dek, row.departedNameCiphertext);
      } catch {
        name = null;
      }
    }
    return { linkId: row.id, name, departedAt: row.departedAt! };
  });
}

// Single-shot, like revokeLink: only an unacknowledged departure the caller
// is party to has anything to acknowledge — anything else is the same
// NotFoundError as an unknown link.
export async function acknowledgeDeparture(linkId: string, byUserId: string): Promise<void> {
  const updated = await db
    .update(therapistLinks)
    .set({ departureAcknowledgedAt: new Date() })
    .where(
      and(
        eq(therapistLinks.id, linkId),
        or(eq(therapistLinks.clientId, byUserId), eq(therapistLinks.therapistId, byUserId)),
        isNotNull(therapistLinks.departedAt),
        isNull(therapistLinks.departureAcknowledgedAt),
      ),
    )
    .returning({ id: therapistLinks.id });
  if (updated.length === 0) throw new NotFoundError("No departure to acknowledge");
}
```

Add the needed imports (`isNotNull`, `isNull` from `drizzle-orm`; `decryptText` from `@/lib/crypto/envelope`; `getOrCreateUserDek` from `@/lib/crypto/user-keys`) to the file's existing import block.

- [ ] **Step 4: Create the route** — `src/app/api/links/[linkId]/acknowledge-departure/route.ts`:

```ts
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { acknowledgeDeparture } from "@/lib/therapist-links";

const paramsSchema = z.object({ linkId: z.uuid() });

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ linkId: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  try {
    await acknowledgeDeparture(params.data.linkId, session.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
```

- [ ] **Step 5: Run tests + gates.** `bun run test && bunx tsc --noEmit && bun run lint` → green.
- [ ] **Step 6: Commit** — `✨ Surface account departures to the surviving link partner`

---

### Task 8: Forgot/reset password pages (UI)

**Files:**
- Create: `src/app/(auth)/forgot-password/page.tsx` (+ form component beside it)
- Create: `src/app/(auth)/reset-password/page.tsx` (+ form component)
- Modify: `src/app/(auth)/sign-in/sign-in-form.tsx` (add the link)

**Contract (design-skills mandate applies — invoke `frontend-design`, `make-interfaces-feel-better`, `transitions-dev`):**
- Match the existing `(auth)` pages' structure, tokens, and tone exactly (read `sign-in` and `sign-up` first).
- Sign-in form gains a quiet "Forgot your password?" link → `/forgot-password`.
- **Forgot page:** one email field + submit via `authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })` (`authClient` from `@/lib/auth-client`). On ANY outcome (success, unknown email, error) show the same calm confirmation: "If that address has an account, a reset link is on its way. It's good for about an hour." — enumeration-free by construction. Disable the button while in flight.
- **Reset page:** reads `token` from the URL query (better-auth's emailed link redirects to `/reset-password?token=…`; also handle `error=INVALID_TOKEN` in the query with honest copy and a link back to `/forgot-password`). One new-password field (minLength 10, mirror sign-up's wording) + submit via `authClient.resetPassword({ newPassword, token })`. Success → brief confirmation + link to `/sign-in`. Failure (expired/used token) → honest copy + link to `/forgot-password`.
- No emails, names, or account details ever rendered from the token.

- [ ] **Step 1: Read `src/app/(auth)/sign-in/` and `sign-up/` for structure; invoke the design skills.**
- [ ] **Step 2: Build both pages + the sign-in link per the contract.**
- [ ] **Step 3: Verify manually** — `bun run dev`, walk `/forgot-password` with a real dev account, pull the link from the `[email mock]` console output, complete the reset, sign in with the new password.
- [ ] **Step 4: Gates.** `bunx tsc --noEmit && bun run lint && bun run build` → green.
- [ ] **Step 5: Commit** — `✨ Walk a forgotten password back through an emailed reset link`

---

### Task 9: /account page + goodbye screen (UI)

**Files:**
- Create: `src/app/account/page.tsx` (+ `account-screen.tsx` component beside it)
- Create: `src/app/goodbye/page.tsx`
- Modify: the chat rail (`src/components/chat/conversation-rail.tsx`) and therapist desk header (`src/app/therapist/` layout/header component) — add the entry affordance

**Contract (design-skills mandate applies):**
- `/account` requires a session (redirect to `/sign-in` otherwise — mirror how `/chat/page.tsx` gates). Shows name + email (server-rendered from the session), then three quiet sections:
  1. **Sign out** — `authClient.signOut()` then hard-navigate to `/`. This is the app's first sign-out control; also add it wherever the account entry point lives if the design wants it there.
  2. **Change password** — current + new fields (min 10), `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`; honest success/failure states; never echo passwords.
  3. **Delete account** — the grave act, visually quiet, never red-alarm (crisis palette rules apply: warm amber, and even that sparingly). Two-step flow per the spec: password field → an explicit acknowledgment step whose copy states exactly what is lost ("your conversations, notes, check-ins and records will be gone — we can't bring them back, and neither can anyone else") and what survives (audit lines; a linked therapist keeps their own notes and sees that you left) → final confirm calls `DELETE /api/account` with `{ password }`. On `204`: `authClient.signOut().catch(() => {})` (clears the cookie; the server session is already gone) then hard-navigate to `/goodbye`. On `400` wrong password / `429`: calm inline error. Use the existing two-step confirm patterns (`notes-screen.tsx` NoteCard, rail hide-confirm focus management) as interaction templates.
- `/goodbye` — public, static, brief: the account is gone, the door stays open, crisis resources line (the standing 988 copy) in the footer. No sign-in wall, no upsell.
- Entry points: rail (client) + desk header (therapist) → `/account`, following each surface's existing affordance patterns.

- [ ] **Step 1: Read the gating pattern in `src/app/chat/page.tsx`, the rail + desk header components; invoke the design skills.**
- [ ] **Step 2: Build the page, goodbye screen, and entry points per the contract.**
- [ ] **Step 3: Verify manually** — sign out/in, change password (old sessions die), delete a throwaway account end-to-end, land on `/goodbye`, confirm sign-in now fails.
- [ ] **Step 4: Gates.** `bunx tsc --noEmit && bun run lint && bun run build` → green.
- [ ] **Step 5: Commit** — `✨ Give accounts a home: sign out, change password, delete`

---

### Task 10: Farewell cards (therapist roster + client trust view) (UI)

**Files:**
- Modify: `src/app/therapist/page.tsx` (fetch departures), `src/components/therapist/client-list.tsx` (render)
- Modify: `src/app/trust/page.tsx` + `src/components/trust/trust-screen.tsx` (client-side mirror)

**Contract (design-skills mandate applies):**
- Both pages additionally call `listDepartures(userId)` (Task 7) server-side and pass the result down.
- **Therapist roster:** an unacknowledged departure renders a quiet card above/with the client list — "«Name» deleted their account." (name `null` → "A client you were linked with deleted their account."), a soft timestamp, and one action ("Okay") that POSTs `/api/links/{linkId}/acknowledge-departure` then refreshes. Follow the existing dashed-border empty-state card language (`client-list.tsx:26-32`); this is a farewell, not an alert — no badges, no red, no amber.
- **Client trust view:** same card, mirrored copy ("«Name», your trusted person, deleted their account."), same acknowledge mechanics, placed where the link-status block lives.
- Focus lands on the safe/neutral element when the card appears; acknowledging returns focus sensibly (rail hide-confirm is the reference).

- [ ] **Step 1: Read both pages/components; invoke the design skills.**
- [ ] **Step 2: Build both cards per the contract.**
- [ ] **Step 3: Verify manually** — seed a departure by deleting a linked throwaway account (Task 9 flow), check both surfaces, acknowledge, confirm it stays gone.
- [ ] **Step 4: Gates.** `bunx tsc --noEmit && bun run lint && bun run build` → green.
- [ ] **Step 5: Commit** — `✨ Say goodbye honestly when a linked account departs`

---

### Task 11: Copy sweep — the IOU comes off the books

**Files:**
- Modify: `README.md` (Privacy Model), `src/components/landing/privacy-section.tsx`, `src/components/landing/faq-section.tsx`, `src/app/llms.txt/route.ts` (or the static `llms.txt` — find it), `docs/DEPLOY.md`, `TODO.md`

**Contract:**
- Every claim must be true of the shipped behavior, in the product's voice:
  - Deletion: self-serve from `/account`; what it does (key shredded so nothing encrypted can ever be read again, rows purged; ids-and-times audit lines remain; a linked therapist keeps their own notes and a name-only farewell marker). Remove every "on request / not yet self-serve" caveat (`grep --recursive --ignore-case "request" README.md src/components/landing/` to find them).
  - Password reset: exists, email-based; it restores access and never exposes or decrypts anyone's content.
- `docs/DEPLOY.md`: add `RESEND_API_KEY` + `EMAIL_FROM` to the config section with a note on Resend domain verification (SPF/DKIM DNS) and that WITHOUT the key the server refuses to send (production has no mock); update the launch-checklist deletion line to point at the self-serve flow.
- `TODO.md`: check off Bar 2's account-management items; note what remains.
- [ ] **Step 1: Sweep and edit all files per the contract.**
- [ ] **Step 2: Gates.** `bun run test && bunx tsc --noEmit && bun run lint && bun run build`.
- [ ] **Step 3: Commit** — `📝 Tell the truth about deletion and recovery — they exist now`

---

### Task 12: e2e journeys

**Files:**
- Create: `e2e/account-deletion.spec.ts`
- Create: `e2e/password-reset.spec.ts`
- Modify: the existing two-context journey spec (find it in `e2e/`) — extend with the farewell

**Contract (read `e2e/` conventions first: sign-in via `POST /api/auth/sign-in/email` fetch, never synthetic form typing; `E2E_PORT=3101 bun run test:e2e`; never navigate in the same batch as an in-flight mutation; 15s expect timeout, `--workers=1` to isolate contention):**
- **account-deletion.spec.ts:** sign up fresh → send one chat message (mock AI) → go to `/account` → walk the two-step delete with the password → land on `/goodbye` → attempt sign-in with the same credentials → it fails with the normal invalid-credentials message.
- **two-context farewell:** client (context A) and linked therapist (context B) from the existing journey helpers; A deletes; B reloads the desk → farewell card with A's name → acknowledge → card gone, roster empty, B's notes surface still renders.
- **password-reset.spec.ts:** UI-level only — `/forgot-password` submits an email and shows the enumeration-free confirmation (for both an existing and a nonexistent address, same copy). The token round-trip itself is covered by Task 4's integration tests (the mock outbox lives in server memory, out of Playwright's reach) — leave a comment in the spec saying exactly that.
- `data-*` hooks: if a selector needs inventing, add a `data-e2e` attribute rather than matching styled text.
- [ ] **Step 1: Write the specs per the contract.**
- [ ] **Step 2: Run.** `E2E_PORT=3101 bun run test:e2e` (in a throwaway worktree at HEAD if a dev server is running — HANDOFF's e2e quirk). Expect: all specs pass; a parallel-only failure → re-verify with `--workers=1`.
- [ ] **Step 3: Full gates one last time.** `bun run test && bunx tsc --noEmit && bun run lint && bun run build`.
- [ ] **Step 4: Commit** — `✅ Prove deletion, farewell, and recovery end-to-end`

---

## Final phase gate (after all tasks)

1. Whole-phase review on the most capable model (per HANDOFF §4) with an accumulated-minors triage table.
2. Human validation: real browser pass over reset (with the console-mock link), change-password, deletion + farewell on both surfaces. Real-Resend send once the user configures `RESEND_API_KEY`/`EMAIL_FROM` + DNS.
3. Update `.superpowers/sdd/progress.md` (the ledger) and `docs/HANDOFF.md`'s state table.
