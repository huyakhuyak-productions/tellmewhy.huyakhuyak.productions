# tellmewhy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the standalone core of tellmewhy — authenticated, mobile-first, streaming AI therapy chat with per-user envelope encryption at rest and crisis detection.

**Architecture:** Next.js (App Router) monolith. All sensitive text (message bodies, conversation titles) is encrypted with a per-user DEK (AES-256-GCM) before touching Postgres; DEKs are wrapped by a KEK behind a `KeyProvider` interface (env-based for MVP, KMS-swappable). The chat API route is the only place plaintext exists: it decrypts history, streams a reply from OpenRouter, and re-encrypts on persist. A risk check runs on every client message; crisis signals break the chat frame in the UI.

**Tech Stack:** Bun (package manager + scripts), Next.js + TypeScript, Postgres (Docker) + Drizzle ORM, Better Auth (Argon2id via `@node-rs/argon2`), Vercel AI SDK (`ai`, `@ai-sdk/react`) + `@openrouter/ai-sdk-provider`, `streamdown` for streaming markdown, Tailwind + shadcn/ui, Vitest, Playwright.

## Global Constraints

- **Encryption:** all message bodies and conversation titles encrypted AES-256-GCM with per-user DEK before Postgres. Ciphertext format: `v1.<iv b64>.<tag b64>.<data b64>`. DEKs wrapped by KEK from `MASTER_KEK` env (base64, 32 bytes) behind the `KeyProvider` interface.
- **Crypto-shredding:** deleting a user's key row makes their data permanently unreadable — this is the deletion mechanism.
- **Passwords:** Argon2id ONLY, explicit params: `memoryCost: 65536` (64 MiB), `timeCost: 3`, `parallelism: 1`. Never library defaults.
- **AI output:** always rendered through a markdown component (`streamdown`), never as a plain string.
- **OpenRouter:** every request sends `provider: { data_collection: "deny" }` (no-logging providers only). Never claim "end-to-end encrypted" in any copy — the honest claim is "encrypted at rest; plaintext only in memory during inference".
- **Forward-compatibility:** `messages.sender` enum includes `therapist` and `system` now (phase 2 uses them); `messages.flagged_at` and `messages.risk_level` exist now.
- **UI tasks:** the implementer MUST load the `frontend-design`, `make-interfaces-feel-better`, and `transitions-dev` skills before writing UI (user directive). Mobile-first: design at 390px width first.
- **Commits:** gitmoji format (see `gitmoji-commit` skill), one behavior per commit, git commands run one at a time, long-form flags.
- **Package installs:** the dependency list is approved once at Task 0 by the user; do not add packages beyond it without asking.
- **Server boundary:** crypto, db, and AI modules must only be imported from server code (route handlers / server components / `"use server"`). Add `import "server-only"` to each.

---

### Task 0: Scaffold, tooling, and dev database

**Files:**
- Create: entire Next.js scaffold (via `create-next-app`), `docker-compose.yml`, `.env.local`, `.env.example`, `vitest.config.ts`, `src/test/setup.ts`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces: running dev app, `bun run test` (Vitest), Postgres on `localhost:5432`, env conventions used by every later task.

- [ ] **Step 1: Confirm dependency list with the user (one-time approval gate)**

Present this list; on approval, everything below is pre-approved:

```
Runtime: drizzle-orm postgres better-auth @node-rs/argon2 ai @ai-sdk/react @openrouter/ai-sdk-provider streamdown zod server-only
Dev:     drizzle-kit vitest @vitejs/plugin-react vite-tsconfig-paths @playwright/test
UI:      tailwindcss (via scaffold), shadcn/ui components (vendored via CLI, not deps)
```

- [ ] **Step 2: Scaffold the app**

```bash
bun create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-bun --yes
```

Expected: Next.js project created in repo root (it tolerates the existing `docs/` and `.git`; if it refuses a non-empty dir, scaffold into `.scaffold-tmp` and move contents up, then delete `.scaffold-tmp`).

- [ ] **Step 3: Install dependencies**

```bash
bun add drizzle-orm postgres better-auth @node-rs/argon2 ai @ai-sdk/react @openrouter/ai-sdk-provider streamdown zod server-only
```

```bash
bun add --development drizzle-kit vitest @vitejs/plugin-react vite-tsconfig-paths @playwright/test
```

- [ ] **Step 4: Dev database**

Create `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: tellmewhy
      POSTGRES_PASSWORD: tellmewhy
      POSTGRES_DB: tellmewhy
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Run: `docker compose up --detach` — expected: `db` container healthy.

- [ ] **Step 5: Environment files**

Create `.env.example` (committed):

```bash
DATABASE_URL=postgres://tellmewhy:tellmewhy@localhost:5432/tellmewhy
BETTER_AUTH_SECRET=            # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
MASTER_KEK=                    # openssl rand -base64 32 — KEK wrapping all user DEKs. LOSS = ALL DATA UNRECOVERABLE.
OPENROUTER_API_KEY=
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_CLASSIFIER_MODEL=google/gemini-2.5-flash-lite
AI_MOCK=0                      # 1 = deterministic mock model (tests/e2e, no network)
```

Create `.env.local` with real values (`openssl rand -base64 32` for the two secrets). Verify `.gitignore` covers `.env*` but keep `.env.example` tracked (add `!.env.example`).

- [ ] **Step 6: Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

Create `src/test/setup.ts`:

```typescript
// Deterministic env for unit tests. 32 zero-bytes base64 — test-only KEK.
process.env.MASTER_KEK = Buffer.alloc(32, 0).toString("base64");
process.env.AI_MOCK = "1";
```

Add to `package.json` scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate"
}
```

- [ ] **Step 7: Verify**

Run: `bun run dev` — expected: Next.js starts on :3000. Run: `bun run test` — expected: "no test files found" exit 0 (or trivial pass).

- [ ] **Step 8: Commit**

```bash
git add --all
git commit --message "🎉 Scaffold Next.js app with dev database and test tooling

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Envelope encryption primitives (TDD)

**Files:**
- Create: `src/lib/crypto/envelope.ts`
- Test: `src/lib/crypto/envelope.test.ts`

**Interfaces:**
- Produces: `generateDek(): Buffer` (32 bytes), `encryptText(dek: Buffer, plaintext: string): string` (returns `v1.<iv>.<tag>.<data>` base64 segments), `decryptText(dek: Buffer, payload: string): string` (throws `CryptoError` on tamper/wrong key/bad format).

- [ ] **Step 1: Write the failing tests**

`src/lib/crypto/envelope.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CryptoError, decryptText, encryptText, generateDek } from "./envelope";

describe("envelope encryption", () => {
  it("round-trips text", () => {
    const dek = generateDek();
    const payload = encryptText(dek, "I feel anxious today 🌧️");
    expect(payload).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]*$/);
    expect(decryptText(dek, payload)).toBe("I feel anxious today 🌧️");
  });

  it("produces different ciphertext for the same plaintext (fresh IV)", () => {
    const dek = generateDek();
    expect(encryptText(dek, "same")).not.toBe(encryptText(dek, "same"));
  });

  it("rejects a tampered payload", () => {
    const dek = generateDek();
    const payload = encryptText(dek, "secret");
    const parts = payload.split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");
    expect(() => decryptText(dek, parts.join("."))).toThrow(CryptoError);
  });

  it("rejects the wrong key", () => {
    const payload = encryptText(generateDek(), "secret");
    expect(() => decryptText(generateDek(), payload)).toThrow(CryptoError);
  });

  it("rejects an unknown format version", () => {
    const dek = generateDek();
    expect(() => decryptText(dek, "v9.a.b.c")).toThrow(CryptoError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/lib/crypto/envelope.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/crypto/envelope.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

export class CryptoError extends Error {}

export function generateDek(): Buffer {
  return randomBytes(32);
}

export function encryptText(dek: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, dek, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(".");
}

export function decryptText(dek: Buffer, payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== VERSION || ivB64 === undefined || tagB64 === undefined || dataB64 === undefined) {
    throw new CryptoError("Unknown ciphertext format");
  }
  try {
    const decipher = createDecipheriv(ALGO, dek, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("Decryption failed");
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/lib/crypto/envelope.test.ts` — expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/envelope.ts src/lib/crypto/envelope.test.ts
git commit --message "✨ Encrypt and decrypt text with AES-256-GCM envelopes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: KeyProvider interface + env-based KEK (TDD)

**Files:**
- Create: `src/lib/crypto/key-provider.ts`
- Test: `src/lib/crypto/key-provider.test.ts`

**Interfaces:**
- Consumes: `encryptText`/`decryptText`/`CryptoError` from Task 1.
- Produces: `interface KeyProvider { wrapDek(dek: Buffer): Promise<string>; unwrapDek(wrapped: string): Promise<Buffer> }`, `class EnvKeyProvider implements KeyProvider`, `getKeyProvider(): KeyProvider` (singleton). Swapping to AWS KMS/Vault later = new class, no data-shape change (wrapped DEKs are opaque strings).

- [ ] **Step 1: Write the failing tests**

`src/lib/crypto/key-provider.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { EnvKeyProvider } from "./key-provider";
import { generateDek } from "./envelope";

describe("EnvKeyProvider", () => {
  const kek = Buffer.alloc(32, 7).toString("base64");

  it("wraps and unwraps a DEK", async () => {
    const provider = new EnvKeyProvider(kek);
    const dek = generateDek();
    const wrapped = await provider.wrapDek(dek);
    expect(wrapped).not.toContain(dek.toString("base64"));
    expect((await provider.unwrapDek(wrapped)).equals(dek)).toBe(true);
  });

  it("fails to unwrap with a different KEK", async () => {
    const wrapped = await new EnvKeyProvider(kek).wrapDek(generateDek());
    const other = new EnvKeyProvider(Buffer.alloc(32, 9).toString("base64"));
    await expect(other.unwrapDek(wrapped)).rejects.toThrow();
  });

  it("rejects a missing or malformed KEK", () => {
    expect(() => new EnvKeyProvider(undefined)).toThrow(/MASTER_KEK/);
    expect(() => new EnvKeyProvider("dG9vLXNob3J0")).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/lib/crypto/key-provider.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/crypto/key-provider.ts`:

```typescript
import { decryptText, encryptText } from "./envelope";

export interface KeyProvider {
  wrapDek(dek: Buffer): Promise<string>;
  unwrapDek(wrapped: string): Promise<Buffer>;
}

export class EnvKeyProvider implements KeyProvider {
  private readonly kek: Buffer;

  constructor(kekBase64: string | undefined = process.env.MASTER_KEK) {
    if (!kekBase64) throw new Error("MASTER_KEK env variable is not set");
    const kek = Buffer.from(kekBase64, "base64");
    if (kek.length !== 32) throw new Error("MASTER_KEK must decode to exactly 32 bytes");
    this.kek = kek;
  }

  async wrapDek(dek: Buffer): Promise<string> {
    return encryptText(this.kek, dek.toString("base64"));
  }

  async unwrapDek(wrapped: string): Promise<Buffer> {
    return Buffer.from(decryptText(this.kek, wrapped), "base64");
  }
}

let singleton: KeyProvider | undefined;

export function getKeyProvider(): KeyProvider {
  singleton ??= new EnvKeyProvider();
  return singleton;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/lib/crypto/key-provider.test.ts` — expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/key-provider.ts src/lib/crypto/key-provider.test.ts
git commit --message "✨ Wrap user DEKs with a swappable master-key provider

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Database schema, client, and user-key lifecycle

**Files:**
- Create: `drizzle.config.ts`, `src/db/schema.ts`, `src/db/index.ts`, `src/lib/crypto/user-keys.ts`
- Test: `src/lib/crypto/user-keys.test.ts` (integration — needs Docker Postgres)

**Interfaces:**
- Consumes: `getKeyProvider`, `generateDek` (Tasks 1–2).
- Produces: Drizzle tables `userKeys`, `conversations`, `messages` (+ Better Auth tables added in Task 4); `db` client; `getOrCreateUserDek(userId: string): Promise<Buffer>`, `shredUserKey(userId: string): Promise<void>`.

- [ ] **Step 1: Drizzle config**

`drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 2: Schema**

`src/db/schema.ts`:

```typescript
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const senderEnum = pgEnum("sender", ["client", "ai", "therapist", "system"]);
export const riskLevelEnum = pgEnum("risk_level", ["none", "elevated", "crisis"]);

// One wrapped DEK per user. Deleting the row = crypto-shredding all their data.
export const userKeys = pgTable("user_keys", {
  userId: text("user_id").primaryKey(),
  wrappedDek: text("wrapped_dek").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  titleCiphertext: text("title_ciphertext").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  sender: senderEnum("sender").notNull(),
  ciphertext: text("ciphertext").notNull(),
  riskLevel: riskLevelEnum("risk_level").notNull().default("none"),
  flaggedAt: timestamp("flagged_at"), // "flag for my therapist" — used from phase 2
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 3: DB client**

`src/db/index.ts`:

```typescript
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
```

Note: tests import `db` too — create `src/db/test-exempt.d.ts`? No: `server-only` throws outside React server context. Instead gate it: replace the first line with a conditional import guard:

```typescript
if (process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("server-only");
}
```

(Vitest sets `NODE_ENV=test` automatically.)

- [ ] **Step 4: Generate and run the migration**

```bash
bun run db:generate
```

```bash
bun run db:migrate
```

Expected: `drizzle/0000_*.sql` created; tables exist (`docker compose exec db psql -U tellmewhy -c '\dt'` shows `user_keys`, `conversations`, `messages`).

- [ ] **Step 5: Write the failing integration test**

`src/lib/crypto/user-keys.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run to verify failure**

Run: `bun run test src/lib/crypto/user-keys.test.ts` — expected: FAIL (module not found).

- [ ] **Step 7: Implement**

`src/lib/crypto/user-keys.ts`:

```typescript
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
```

- [ ] **Step 8: Run to verify pass**

Run: `bun run test src/lib/crypto/user-keys.test.ts` — expected: 3 passed. Also run the full suite: `bun run test` — all green.

- [ ] **Step 9: Commit**

```bash
git add drizzle.config.ts drizzle src/db src/lib/crypto/user-keys.ts src/lib/crypto/user-keys.test.ts
git commit --message "✨ Provision and crypto-shred per-user data keys

Deleting a user's key row makes every row they own permanently
unreadable — this is the GDPR deletion mechanism.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Better Auth with Argon2id and roles

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/password.ts`, `src/app/api/auth/[...all]/route.ts`, `src/db/auth-schema.ts` (generated)
- Test: `src/lib/password.test.ts`

**Interfaces:**
- Consumes: `db` (Task 3).
- Produces: `auth` (server instance; `auth.api.getSession({ headers })` used by every protected route), `authClient` (React client: `authClient.signUp.email(...)`, `authClient.signIn.email(...)`, `authClient.signOut()`), `hashPassword(password: string): Promise<string>`, `verifyPassword(input: { hash: string; password: string }): Promise<boolean>`. User model has `role: "client" | "therapist"` (default `"client"`).

- [ ] **Step 1: Write the failing password tests**

`src/lib/password.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes with Argon2id and hardened parameters", async () => {
    const hash = await hashPassword("correct horse battery staple");
    // PHC string encodes algorithm and params — assert them explicitly.
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).toContain("m=65536,t=3,p=1");
  });

  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword({ hash, password: "s3cret-passphrase" })).toBe(true);
    expect(await verifyPassword({ hash, password: "wrong" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/lib/password.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement password module**

`src/lib/password.ts`:

```typescript
import { hash, verify, Algorithm } from "@node-rs/argon2";

// OWASP-recommended Argon2id, explicit params — never library defaults.
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  return verify(input.hash, input.password).catch(() => false);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/lib/password.test.ts` — expected: 2 passed.

- [ ] **Step 5: Configure Better Auth**

`src/lib/auth.ts`:

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    password: { hash: hashPassword, verify: verifyPassword },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "client", input: false },
    },
  },
});
```

`src/app/api/auth/[...all]/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

`src/lib/auth-client.ts`:

```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

- [ ] **Step 6: Generate auth tables and migrate**

```bash
bunx @better-auth/cli generate --config src/lib/auth.ts --output src/db/auth-schema.ts
```

Then re-export from `src/db/schema.ts` (append):

```typescript
export * from "./auth-schema";
```

```bash
bun run db:generate
```

```bash
bun run db:migrate
```

Expected: `user`, `session`, `account`, `verification` tables exist; `user.role` column present. (If the CLI flags differ in the installed version, check `bunx @better-auth/cli generate --help`.)

- [ ] **Step 7: Smoke-test signup end-to-end**

Run dev server, then:

```bash
curl --silent --request POST http://localhost:3000/api/auth/sign-up/email \
  --header "content-type: application/json" \
  --data '{"email":"smoke@test.dev","password":"longenough-pass","name":"Smoke"}'
```

Expected: JSON with a user object. Verify the stored hash:

```bash
docker compose exec db psql -U tellmewhy --command "select password from account limit 1;"
```

Expected: starts with `$argon2id$` and contains `m=65536,t=3,p=1`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth.ts src/lib/auth-client.ts src/lib/password.ts src/lib/password.test.ts src/app/api/auth src/db/auth-schema.ts src/db/schema.ts drizzle
git commit --message "✨ Sign up and sign in with Argon2id-hashed passwords

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Encrypted conversation + message repository (TDD)

**Files:**
- Create: `src/lib/conversations.ts`
- Test: `src/lib/conversations.test.ts` (integration — Docker Postgres)

**Interfaces:**
- Consumes: `db`, schema tables (Task 3), `getOrCreateUserDek`, `encryptText`, `decryptText`.
- Produces:
  - `createConversation(userId: string, title: string): Promise<{ id: string }>`
  - `listConversations(userId: string): Promise<{ id: string; title: string; updatedAt: Date }[]>`
  - `saveMessage(input: { conversationId: string; userId: string; sender: "client" | "ai" | "therapist" | "system"; text: string; riskLevel?: "none" | "elevated" | "crisis" }): Promise<{ id: string }>`
  - `loadMessages(conversationId: string, userId: string): Promise<{ id: string; sender: string; text: string; riskLevel: string; createdAt: Date }[]>`
  - All functions throw `NotFoundError` when the conversation doesn't belong to `userId` (ownership is enforced HERE, not in routes).

- [ ] **Step 1: Write the failing tests**

`src/lib/conversations.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NotFoundError, createConversation, listConversations, loadMessages, saveMessage } from "./conversations";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";

describe("encrypted conversations", () => {
  let userId: string;
  beforeEach(() => {
    userId = `test-${randomUUID()}`;
  });

  it("stores the title and message bodies as ciphertext only", async () => {
    const { id } = await createConversation(userId, "Feeling overwhelmed");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "I had a rough day" });

    const [convRow] = await db.select().from(conversations).where(eq(conversations.id, id));
    const msgRows = await db.select().from(messages).where(eq(messages.conversationId, id));
    expect(convRow.titleCiphertext).not.toContain("overwhelmed");
    expect(msgRows[0].ciphertext).not.toContain("rough day");
  });

  it("round-trips messages in order with decrypted text", async () => {
    const { id } = await createConversation(userId, "Check-in");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "hello" });
    await saveMessage({ conversationId: id, userId, sender: "ai", text: "hi, how are you feeling?" });

    const loaded = await loadMessages(id, userId);
    expect(loaded.map((m) => [m.sender, m.text])).toEqual([
      ["client", "hello"],
      ["ai", "hi, how are you feeling?"],
    ]);
  });

  it("lists conversations with decrypted titles, newest first", async () => {
    await createConversation(userId, "First");
    await createConversation(userId, "Second");
    const list = await listConversations(userId);
    expect(list.map((c) => c.title)).toEqual(["Second", "First"]);
  });

  it("refuses access to another user's conversation", async () => {
    const { id } = await createConversation(userId, "Private");
    await expect(loadMessages(id, "someone-else")).rejects.toThrow(NotFoundError);
    await expect(
      saveMessage({ conversationId: id, userId: "someone-else", sender: "client", text: "hi" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("persists riskLevel on messages", async () => {
    const { id } = await createConversation(userId, "Hard night");
    await saveMessage({ conversationId: id, userId, sender: "client", text: "…", riskLevel: "crisis" });
    const [m] = await loadMessages(id, userId);
    expect(m.riskLevel).toBe("crisis");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/lib/conversations.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/conversations.ts`:

```typescript
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";

export class NotFoundError extends Error {}

type Sender = "client" | "ai" | "therapist" | "system";
type RiskLevel = "none" | "elevated" | "crisis";

async function requireOwnedConversation(conversationId: string, userId: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!row) throw new NotFoundError("Conversation not found");
  return row;
}

export async function createConversation(userId: string, title: string): Promise<{ id: string }> {
  const dek = await getOrCreateUserDek(userId);
  const [row] = await db
    .insert(conversations)
    .values({ userId, titleCiphertext: encryptText(dek, title) })
    .returning({ id: conversations.id });
  return row;
}

export async function listConversations(userId: string) {
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt));
  return rows.map((r) => ({ id: r.id, title: decryptText(dek, r.titleCiphertext), updatedAt: r.updatedAt }));
}

export async function saveMessage(input: {
  conversationId: string;
  userId: string;
  sender: Sender;
  text: string;
  riskLevel?: RiskLevel;
}): Promise<{ id: string }> {
  await requireOwnedConversation(input.conversationId, input.userId);
  const dek = await getOrCreateUserDek(input.userId);
  const [row] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      sender: input.sender,
      ciphertext: encryptText(dek, input.text),
      riskLevel: input.riskLevel ?? "none",
    })
    .returning({ id: messages.id });
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, input.conversationId));
  return row;
}

export async function loadMessages(conversationId: string, userId: string) {
  await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return rows.map((r) => ({
    id: r.id,
    sender: r.sender,
    text: decryptText(dek, r.ciphertext),
    riskLevel: r.riskLevel,
    createdAt: r.createdAt,
  }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/lib/conversations.test.ts` — expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversations.ts src/lib/conversations.test.ts
git commit --message "✨ Store conversations and messages encrypted per user

Ownership is enforced in the repository layer, so no route can
read another user's data even by mistake.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Crisis detection (TDD)

**Files:**
- Create: `src/lib/ai/crisis.ts`
- Test: `src/lib/ai/crisis.test.ts`

**Interfaces:**
- Consumes: OpenRouter classifier model (Task 7's `getClassifierModel` — for THIS task, the classifier model is injected as a parameter so tests need no network).
- Produces:
  - `type RiskLevel = "none" | "elevated" | "crisis"`
  - `screenText(text: string): RiskLevel` — synchronous regex fast-path, never misses the explicit phrases below.
  - `assessRisk(text: string, model: LanguageModel): Promise<RiskLevel>` — LLM classification with 2.5s timeout; NEVER returns lower than `screenText` (the regex result is the floor); returns the regex result on any model failure.

- [ ] **Step 1: Write the failing tests**

`src/lib/ai/crisis.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { assessRisk, screenText } from "./crisis";

// If `MockLanguageModelV2` is missing in the installed ai version, check
// `bun pm ls ai` and the `ai/test` exports — use the current mock class name.

function mockClassifier(reply: string) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text: reply }],
      warnings: [],
    }),
  });
}

describe("screenText", () => {
  it.each([
    "I want to kill myself",
    "i've been thinking about ending my life",
    "I don't want to be alive anymore",
    "thinking about suicide again",
    "I want to hurt myself tonight",
  ])("flags explicit crisis phrasing: %s", (text) => {
    expect(screenText(text)).toBe("crisis");
  });

  it.each(["I had a hard day at work", "my plant died and I'm sad", "I killed it at the gym"])(
    "does not flag ordinary distress: %s",
    (text) => {
      expect(screenText(text)).toBe("none");
    },
  );
});

describe("assessRisk", () => {
  it("returns the model's verdict when the regex finds nothing", async () => {
    const level = await assessRisk("everything feels pointless lately", mockClassifier('{"risk":"elevated"}'));
    expect(level).toBe("elevated");
  });

  it("never downgrades below the regex floor", async () => {
    const level = await assessRisk("I want to kill myself", mockClassifier('{"risk":"none"}'));
    expect(level).toBe("crisis");
  });

  it("falls back to the regex result when the model fails", async () => {
    const broken = new MockLanguageModelV2({
      doGenerate: async () => {
        throw new Error("provider down");
      },
    });
    expect(await assessRisk("I want to kill myself", broken)).toBe("crisis");
    expect(await assessRisk("rough week", broken)).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/lib/ai/crisis.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/ai/crisis.ts`:

```typescript
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

export type RiskLevel = "none" | "elevated" | "crisis";

const RANK: Record<RiskLevel, number> = { none: 0, elevated: 1, crisis: 2 };

// Fast-path patterns for explicit self-harm/suicidal intent. Deliberately
// high-precision: the LLM pass catches subtler phrasing; this floor makes
// sure the explicit cases can never be missed, even with the model down.
const CRISIS_PATTERNS: RegExp[] = [
  /\bkill(?:ing)? myself\b/i,
  /\bend(?:ing)? my (?:own )?life\b/i,
  /\bsuicid/i,
  /\bdon'?t want to (?:be alive|live|exist)\b/i,
  /\bwant(?:ing)? to die\b/i,
  /\bhurt(?:ing)? myself\b/i,
  /\bself[- ]harm/i,
  /\bno reason to (?:live|go on)\b/i,
];

export function screenText(text: string): RiskLevel {
  return CRISIS_PATTERNS.some((p) => p.test(text)) ? "crisis" : "none";
}

const riskSchema = z.object({ risk: z.enum(["none", "elevated", "crisis"]) });

export async function assessRisk(text: string, model: LanguageModel): Promise<RiskLevel> {
  const floor = screenText(text);
  try {
    const { object } = await generateObject({
      model,
      schema: riskSchema,
      abortSignal: AbortSignal.timeout(2500),
      system:
        "You are a safety classifier for a mental-health support chat. " +
        "Classify the user's message: 'crisis' = active self-harm or suicidal intent; " +
        "'elevated' = significant hopelessness or passive ideation worth extra care; " +
        "'none' = ordinary distress or everyday conversation. Respond with the classification only.",
      prompt: text,
    });
    return RANK[object.risk] > RANK[floor] ? object.risk : floor;
  } catch {
    return floor; // model unavailable — the regex floor still stands
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/lib/ai/crisis.test.ts` — expected: all passed. (If `generateObject` with the mock needs a JSON response format, set `doGenerate`'s `content` text to the raw JSON as shown — `generateObject` parses text output.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/crisis.ts src/lib/ai/crisis.test.ts
git commit --message "✨ Detect crisis signals in every client message

Regex fast-path is the floor; an LLM pass catches subtler
phrasing and can only raise the level, never lower it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Model providers + system prompt

**Files:**
- Create: `src/lib/ai/models.ts`, `src/lib/ai/system-prompt.ts`
- Test: `src/lib/ai/models.test.ts`

**Interfaces:**
- Consumes: env vars from Task 0.
- Produces: `getChatModel(): LanguageModel`, `getClassifierModel(): LanguageModel` — both return deterministic mocks when `AI_MOCK=1` (chat mock streams a fixed reply; classifier mock returns `crisis` iff the prompt contains `MOCK_CRISIS`, else `none`); `buildSystemPrompt(): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/ai/models.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateText } from "ai";
import { getChatModel } from "./models";

describe("mock chat model (AI_MOCK=1 in test setup)", () => {
  it("returns deterministic text without network access", async () => {
    const { text } = await generateText({ model: getChatModel(), prompt: "hello" });
    expect(text).toContain("mock reply");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/lib/ai/models.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/ai/models.ts`:

```typescript
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { MockLanguageModelV2, simulateReadableStream } from "ai/test";

// Privacy: refuse providers that log or train on prompts. This ships with
// EVERY OpenRouter request — it is part of the product's trust contract.
const NO_LOGGING = { provider: { data_collection: "deny" } };

function openrouter() {
  return createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
    extraBody: NO_LOGGING,
  });
}

function mockChatModel(): LanguageModel {
  return new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "This is a **mock reply** for tests." },
          { type: "text-end", id: "1" },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ],
      }),
    }),
  });
}

function mockClassifierModel(): LanguageModel {
  return new MockLanguageModelV2({
    doGenerate: async ({ prompt }) => ({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [
        { type: "text", text: JSON.stringify({ risk: JSON.stringify(prompt).includes("MOCK_CRISIS") ? "crisis" : "none" }) },
      ],
      warnings: [],
    }),
  });
}

export function getChatModel(): LanguageModel {
  if (process.env.AI_MOCK === "1") return mockChatModel();
  return openrouter()(process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5");
}

export function getClassifierModel(): LanguageModel {
  if (process.env.AI_MOCK === "1") return mockClassifierModel();
  return openrouter()(process.env.OPENROUTER_CLASSIFIER_MODEL ?? "google/gemini-2.5-flash-lite");
}
```

(If the installed `ai` version renames the mock/stream test helpers, check the `ai/test` exports and adjust — the shape of the chunks is the part that matters.)

`src/lib/ai/system-prompt.ts`:

```typescript
export function buildSystemPrompt(): string {
  return [
    "You are a warm, attentive emotional-support companion inside the tellmewhy app.",
    "The person is talking to you the way they would talk to a therapist between sessions.",
    "",
    "How to respond:",
    "- Listen first. Reflect what you heard before offering anything.",
    "- Ask one gentle, open question at a time. Never interrogate.",
    "- Validate feelings without rushing to fix them. Avoid toxic positivity.",
    "- Keep replies short and human — a few sentences, not essays.",
    "- Markdown is supported; use it sparingly (emphasis, short lists).",
    "",
    "Boundaries:",
    "- You are not a licensed therapist and do not diagnose, prescribe, or treat.",
    "- If asked, be honest that you are an AI companion.",
    "- If the person mentions self-harm or suicide, respond with care and seriousness,",
    "  acknowledge their pain, and encourage them to reach out to a crisis line or a",
    "  trusted person right away. Never provide methods or encouragement of self-harm.",
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/lib/ai/models.test.ts` — expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/models.ts src/lib/ai/system-prompt.ts src/lib/ai/models.test.ts
git commit --message "✨ Stream replies from OpenRouter with no-logging providers only

AI_MOCK=1 swaps in deterministic mock models so tests and e2e
runs never touch the network.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Streaming chat API route

**Files:**
- Create: `src/app/api/chat/route.ts`, `src/app/api/conversations/route.ts`
- Test: `src/app/api/chat/route.test.ts`

**Interfaces:**
- Consumes: `auth` (Task 4), `conversations` repo (Task 5), `assessRisk`/`screenText` (Task 6), models + system prompt (Task 7), notes-for-phase-2: therapist AI instructions will be appended to the system prompt here.
- Produces:
  - `POST /api/chat` body `{ conversationId: string; text: string }` → UI message stream response; header `x-risk-level: none|elevated|crisis` on the response; persists both the client message (with risk level) and the AI reply, encrypted.
  - `POST /api/conversations` body `{ title: string }` → `{ id }`; `GET /api/conversations` → list.

- [ ] **Step 1: Write the failing route test**

`src/app/api/chat/route.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createConversation, loadMessages } from "@/lib/conversations";

// Auth is mocked at the module boundary; everything below it is real
// (repo, crypto, mock models via AI_MOCK=1).
const userId = `test-${randomUUID()}`;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: userId } })) } },
}));
// next/headers needs Next.js request scope — stub it for direct route invocation.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST } from "./route";

function chatRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  it("streams a reply and persists both messages encrypted", async () => {
    const { id } = await createConversation(userId, "Test chat");
    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish persistence runs
    await vi.waitFor(async () => {
      const msgs = await loadMessages(id, userId);
      expect(msgs.map((m) => m.sender)).toEqual(["client", "ai"]);
      expect(msgs[1].text).toContain("mock reply");
    });
  });

  it("marks crisis messages and reports the level in a header", async () => {
    const { id } = await createConversation(userId, "Hard night");
    const res = await POST(chatRequest({ conversationId: id, text: "I want to kill myself" }));
    expect(res.headers.get("x-risk-level")).toBe("crisis");
    await res.text();
    const [clientMsg] = await loadMessages(id, userId);
    expect(clientMsg.riskLevel).toBe("crisis");
  });

  it("rejects a conversation the user does not own", async () => {
    const foreign = await createConversation("someone-else", "Not yours");
    const res = await POST(chatRequest({ conversationId: foreign.id, text: "hi" }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/app/api/chat/route.test.ts` — expected: FAIL (module not found).

- [ ] **Step 3: Implement the chat route**

`src/app/api/chat/route.ts`:

```typescript
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError, loadMessages, saveMessage } from "@/lib/conversations";
import { assessRisk } from "@/lib/ai/crisis";
import { getChatModel, getClassifierModel } from "@/lib/ai/models";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";

const bodySchema = z.object({ conversationId: z.string().uuid(), text: z.string().min(1).max(8000) });

const CONTEXT_WINDOW = 30; // most recent messages sent to the model

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const { conversationId, text } = parsed.data;

  try {
    const riskLevel = await assessRisk(text, getClassifierModel());
    await saveMessage({ conversationId, userId, sender: "client", text, riskLevel });

    const history = await loadMessages(conversationId, userId);
    const uiMessages: UIMessage[] = history.slice(-CONTEXT_WINDOW).map((m) => ({
      id: m.id,
      role: m.sender === "client" ? "user" : "assistant",
      parts: [{ type: "text", text: m.text }],
    }));

    const system =
      riskLevel === "crisis"
        ? buildSystemPrompt() +
          "\n\nIMPORTANT: The latest message shows possible self-harm or suicidal intent. " +
          "Respond with warmth and seriousness, and gently encourage immediate real-world support."
        : buildSystemPrompt();

    const result = streamText({
      model: getChatModel(),
      system,
      messages: convertToModelMessages(uiMessages),
      onFinish: async ({ text: replyText }) => {
        await saveMessage({ conversationId, userId, sender: "ai", text: replyText });
      },
    });

    return result.toUIMessageStreamResponse({ headers: { "x-risk-level": riskLevel } });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
```

- [ ] **Step 4: Implement the conversations route**

`src/app/api/conversations/route.ts`:

```typescript
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/conversations";

const createSchema = z.object({ title: z.string().min(1).max(200) });

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await listConversations(session.user.id));
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const conversation = await createConversation(session.user.id, parsed.data.title);
  return Response.json(conversation, { status: 201 });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun run test src/app/api/chat/route.test.ts` — expected: 3 passed. Full suite: `bun run test` — all green.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/chat src/app/api/conversations
git commit --message "✨ Chat with the AI over an encrypted, risk-checked stream

Every client message is risk-assessed before the reply streams;
crisis level travels to the client in an x-risk-level header and
persists on the message row for the phase-2 therapist queue.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: UI — auth screens, conversation list, chat screen, crisis frame-break

> **REQUIRED before starting:** load `frontend-design`, `make-interfaces-feel-better`, and `transitions-dev` skills (user directive). Design mobile-first at 390px. The code below is the working structural baseline; the design skills govern the final look (typography, spacing, motion, color) — refine styling, do not change behavior or file boundaries.

**Files:**
- Create: `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-up/page.tsx`, `src/app/chat/page.tsx`, `src/app/chat/[conversationId]/page.tsx`, `src/components/chat/chat-screen.tsx`, `src/components/chat/message-bubble.tsx`, `src/components/chat/crisis-banner.tsx`, `src/components/chat/new-conversation-button.tsx`, `src/middleware.ts`
- Modify: `src/app/page.tsx` (redirect: signed-in → `/chat`, else → `/sign-in`), `src/app/layout.tsx` (metadata, viewport)

**Interfaces:**
- Consumes: `authClient` (Task 4), `GET/POST /api/conversations`, `POST /api/chat` with `x-risk-level` header (Task 8), `streamdown` for AI text.
- Produces: the complete user-facing app for phase 1.

- [ ] **Step 1: Auth middleware**

`src/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/chat/:path*"] };
```

- [ ] **Step 2: Sign-up / sign-in pages**

`src/app/(auth)/sign-up/page.tsx` (sign-in is identical with `signIn.email`, adjusted copy, and a link to sign-up):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({ name, email, password });
    setPending(false);
    if (error) return setError(error.message ?? "Something went wrong");
    router.push("/chat");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Create your space</h1>
        <p className="text-sm text-muted-foreground">A private place to talk about how you feel.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input className="rounded-lg border px-3 py-2" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="rounded-lg border px-3 py-2" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="rounded-lg border px-3 py-2" type="password" placeholder="Password (10+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="rounded-lg bg-foreground py-2 text-background disabled:opacity-50" disabled={pending}>
          {pending ? "Creating…" : "Start talking"}
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Already here? <Link className="underline" href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Conversation list (`/chat`)**

`src/app/chat/page.tsx`:

```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import { NewConversationButton } from "@/components/chat/new-conversation-button";

export default async function ChatListPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const conversations = await listConversations(session.user.id);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Your conversations</h1>
      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">This space is yours. Start whenever you&apos;re ready.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/chat/${c.id}`} className="block rounded-xl border px-4 py-3">
                <span className="font-medium">{c.title}</span>
                <span className="block text-xs text-muted-foreground">{c.updatedAt.toLocaleDateString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewConversationButton />
    </main>
  );
}
```

`src/components/chat/new-conversation-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewConversationButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" }) }),
    });
    setPending(false);
    if (!res.ok) return;
    const { id } = await res.json();
    router.push(`/chat/${id}`);
  }

  return (
    <button onClick={create} disabled={pending} className="rounded-xl bg-foreground py-3 text-background disabled:opacity-50">
      {pending ? "Opening…" : "New conversation"}
    </button>
  );
}
```

- [ ] **Step 4: Chat screen**

`src/app/chat/[conversationId]/page.tsx` — server component: session check, `loadMessages(conversationId, userId)` (404 → `notFound()`), pass decrypted initial messages to the client component:

```tsx
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NotFoundError, loadMessages } from "@/lib/conversations";
import { ChatScreen } from "@/components/chat/chat-screen";

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  try {
    const initialMessages = await loadMessages(conversationId, session.user.id);
    return <ChatScreen conversationId={conversationId} initialMessages={initialMessages} />;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
```

`src/components/chat/chat-screen.tsx` — client component using `useChat` from `@ai-sdk/react` with a `DefaultChatTransport` that sends `{ conversationId, text }` (server owns history; see Task 8 contract), reads `x-risk-level` from the response to show the crisis banner, renders messages via `MessageBubble`, auto-scrolls, and has a bottom-fixed composer (textarea + send). Key excerpt:

```tsx
"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageBubble } from "./message-bubble";
import { CrisisBanner } from "./crisis-banner";

export function ChatScreen({ conversationId, initialMessages }: {
  conversationId: string;
  initialMessages: { id: string; sender: string; text: string }[];
}) {
  const [crisis, setCrisis] = useState(false);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => {
        const last = messages[messages.length - 1];
        const text = last.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
        return { body: { conversationId, text } };
      },
      fetch: async (input, init) => {
        const res = await fetch(input, init);
        if (res.headers.get("x-risk-level") === "crisis") setCrisis(true);
        return res;
      },
    }),
    messages: initialMessages.map((m) => ({
      id: m.id,
      role: m.sender === "client" ? ("user" as const) : ("assistant" as const),
      parts: [{ type: "text" as const, text: m.text }],
    })),
  });

  const [draft, setDraft] = useState("");

  function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || status === "streaming") return;
    sendMessage({ text: draft });
    setDraft("");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            role={m.role === "user" ? "user" : "assistant"}
            text={m.parts.filter((p) => p.type === "text").map((p) => p.text).join("")}
          />
        ))}
      </div>
      {crisis && <CrisisBanner onDismiss={() => setCrisis(false)} />}
      <form onSubmit={onSend} className="sticky bottom-0 flex gap-2 border-t bg-background px-4 py-3">
        <textarea
          className="min-h-11 flex-1 resize-none rounded-xl border px-3 py-2"
          placeholder="What's on your mind?"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
        />
        <button className="rounded-xl bg-foreground px-4 text-background disabled:opacity-50" disabled={status === "streaming"}>
          Send
        </button>
      </form>
    </div>
  );
}
```

(Add auto-scroll-to-bottom on new messages during the design pass — a `useEffect` on `messages.length` scrolling a sentinel `div` into view.)

`src/components/chat/message-bubble.tsx` — AI text rendered through `Streamdown` (never a plain string), client text plain:

```tsx
import { Streamdown } from "streamdown";

export function MessageBubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  if (role === "user") {
    return <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-4 py-2.5 text-background">{text}</div>;
  }
  return (
    <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5">
      <Streamdown>{text}</Streamdown>
    </div>
  );
}
```

- [ ] **Step 5: Crisis frame-break banner**

`src/components/chat/crisis-banner.tsx` — breaks the chat frame: fixed overlay card above the composer, calm but unmissable, with hotline resources and a dismiss ("I'm safe right now"):

```tsx
export function CrisisBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div role="alertdialog" aria-label="Support resources" className="fixed inset-x-3 bottom-24 z-50 rounded-2xl border bg-background p-4 shadow-xl">
      <p className="font-medium">It sounds like you're carrying something really heavy.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        You deserve support from a real person, right now if you need it:
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        <li><a className="underline" href="tel:988">988 — Suicide &amp; Crisis Lifeline (US, call or text)</a></li>
        <li><a className="underline" href="https://findahelpline.com" target="_blank" rel="noreferrer">findahelpline.com — international lines</a></li>
        <li>If you're in immediate danger, call your local emergency number.</li>
      </ul>
      <button onClick={onDismiss} className="mt-3 w-full rounded-lg border py-2 text-sm">I'm safe right now</button>
    </div>
  );
}
```

- [ ] **Step 6: Root redirect + layout metadata**

`src/app/page.tsx`: server component — session via `auth.api.getSession`; redirect to `/chat` or `/sign-in`. `src/app/layout.tsx`: title "tellmewhy", description "A private place to talk about how you feel." (No E2EE claims anywhere in copy.)

- [ ] **Step 7: Manual verification**

Run `bun run dev` with `AI_MOCK=1`. On a 390px viewport: sign up → land on `/chat` → create conversation → send message → mock reply streams with markdown bold rendered. Send "MOCK_CRISIS I want to kill myself" → crisis banner appears. Then with `AI_MOCK=0` + real `OPENROUTER_API_KEY`: hold a short real conversation.

- [ ] **Step 8: Commit**

```bash
git add src/app src/components src/middleware.ts
git commit --message "💄 Mobile-first chat, auth screens, and crisis frame-break

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Playwright e2e

**Files:**
- Create: `playwright.config.ts`, `e2e/chat.spec.ts`

**Interfaces:**
- Consumes: the full running app with `AI_MOCK=1` and Docker Postgres.

- [ ] **Step 1: Config**

`playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  projects: [{ name: "mobile", use: { ...devices["iPhone 14"] } }],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: { AI_MOCK: "1" },
  },
});
```

Add script: `"test:e2e": "playwright test"`. Run `bunx playwright install chromium` (browser binary, pre-approved).

- [ ] **Step 2: The spec**

`e2e/chat.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("sign up, chat, get a streamed AI reply", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.dev`;
  await page.goto("/sign-up");
  await page.getByPlaceholder("Your name").fill("E2E");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill("longenough-pass");
  await page.getByRole("button", { name: /start talking/i }).click();
  await expect(page).toHaveURL(/\/chat/);

  await page.getByRole("button", { name: /new conversation/i }).click();
  await page.getByRole("textbox").last().fill("I had a strange day");
  await page.getByRole("button", { name: /send/i }).click();

  await expect(page.getByText("mock reply")).toBeVisible();
  // Markdown is rendered, not shown raw:
  await expect(page.locator("strong", { hasText: "mock reply" })).toBeVisible();
});

test("crisis message breaks the chat frame with resources", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.dev`;
  await page.goto("/sign-up");
  await page.getByPlaceholder("Your name").fill("E2E");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill("longenough-pass");
  await page.getByRole("button", { name: /start talking/i }).click();

  await page.getByRole("button", { name: /new conversation/i }).click();
  await page.getByRole("textbox").last().fill("MOCK_CRISIS I want to kill myself");
  await page.getByRole("button", { name: /send/i }).click();

  await expect(page.getByRole("alertdialog", { name: /support resources/i })).toBeVisible();
  await expect(page.getByText(/988/)).toBeVisible();
});
```

(Adjust selectors to the final Task 9 markup if the design pass changed labels — behavior, not styling, is under test.)

- [ ] **Step 3: Run**

Run: `bun run test:e2e` — expected: 2 passed (Postgres must be up).

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e package.json
git commit --message "✅ Cover signup, chat streaming, and crisis flow end-to-end

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: README + privacy copy

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Sections: what tellmewhy is (one paragraph); local setup (`docker compose up --detach`, `.env.local` from `.env.example`, `bun install`, `bun run db:migrate`, `bun run dev`); testing (`bun run test`, `bun run test:e2e`); **Privacy model** — verbatim constraints: per-user envelope encryption at rest (AES-256-GCM, DEK-per-user wrapped by a master key), crypto-shredding on deletion, plaintext exists only in memory during inference, OpenRouter restricted to no-logging providers, **explicitly: "this is not end-to-end encryption, and we don't claim it is"**; **Operational requirements** — `MASTER_KEK` loss means all user data is unrecoverable (back it up in a secrets manager), and the OpenRouter account's data-policy setting must be verified to exclude logging providers before production use.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit --message "📝 Document setup and the honest privacy model

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification (whole sub-project)

1. `bun run test` — all Vitest suites green (crypto, keys, conversations, crisis, models, chat route).
2. `bun run test:e2e` — both Playwright specs green on the iPhone-14 profile.
3. Ciphertext check: `docker compose exec db psql -U tellmewhy --command "select ciphertext from messages limit 3;"` — rows are `v1.…` blobs, no readable text; same for `title_ciphertext` and `account.password` (`$argon2id$…m=65536,t=3,p=1`).
4. Real-model smoke test (`AI_MOCK=0`): hold a short conversation on a phone-sized viewport; confirm streaming, markdown rendering, and persistence across reload.
5. OpenRouter dashboard: confirm the account data policy excludes logging/training providers (also enforced per-request via `data_collection: "deny"`).
6. Then: user validation (Task list #4) → superpowers code review (Task list #5).
