# tellmewhy

A mobile-first web app for talking with an AI about your feelings. Messages are encrypted at rest, and every conversation is encrypted before reaching the database. Crisis signals trigger a detection system that shows crisis resources (988, findahelpline.com). This is not a medical device and not a replacement for professional care. Therapist review is planned for phase 2.

## Local Setup

**1. Start the database**

```bash
docker compose up --detach
```

Postgres 17 runs on `localhost:5432`.

**2. Copy and configure environment variables**

```bash
cp .env.example .env.local
```

Then open `.env.local` and fill in the secrets (use `openssl rand -base64 32` for both `BETTER_AUTH_SECRET` and `MASTER_KEK`):

```bash
openssl rand -base64 32  # Run this twice, once for each secret
```

Set `OPENROUTER_API_KEY` to your OpenRouter key. Leave `AI_MOCK=0` for real inference, or set `AI_MOCK=1` for offline deterministic mocking.

**3. Install dependencies and migrate**

```bash
bun install
bun run db:migrate
```

**4. Start the dev server**

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) on a mobile viewport (iPhone 14 or similar) to see the app.

## Testing

**Run all tests (Vitest):**

```bash
bun run test
```

Integration tests connect to the docker-compose database by default — deliberately ignoring `.env.local`, so a test run can never follow an env file to a real database. Export `DATABASE_URL` explicitly to override.

**Run end-to-end tests (Playwright):**

```bash
bun run test:e2e
```

Playwright boots its own dev server with test-only environment baked into `playwright.config.ts`.

**Offline AI for testing:**

Set `AI_MOCK=1` to use deterministic mock replies and trigger the mock crisis classifier without calling OpenRouter:

```bash
AI_MOCK=1 bun run dev
```

## Privacy Model

**Per-user envelope encryption at rest:**
Every message body and conversation title is encrypted with AES-256-GCM using a per-user data encryption key (DEK). DEKs are wrapped by a master key (`MASTER_KEK`) before being stored. This means that without the master key, no message is readable—even with database access. The wrapping goes through a swappable `KeyProvider` interface, so a KMS/Vault-backed provider can replace the env-based master key in production without re-encrypting any data.

**Crypto-shredding on deletion:**
Destroying a user's wrapped-key row is the designed mechanism for account deletion: it immediately and permanently renders that user's data unreadable going forward. The underlying function (`shredUserKey`) is implemented and tested but is not yet wired to a user-facing deletion flow—self-serve account deletion ships with the account-management phase. Note that a database backup taken *before* the key row is destroyed still contains the wrapped DEK and remains decryptable with `MASTER_KEK`; shredding only guarantees unreadability going forward, unless the master key is rotated or key rows are excluded from backup retention.

**Plaintext exists only in memory:**
Message bodies exist as plaintext only during request handling and during AI inference. After inference completes, the plaintext is discarded and only the ciphertext is stored. Message timestamps and risk-level flags are not encrypted—a database breach would reveal when conversations happened and which messages were flagged as crisis-level, but never their content.

**OpenRouter data policies:**
All LLM calls route through OpenRouter with strict per-request `data_collection: "deny"` headers. The OpenRouter account's global data policy must be configured to exclude logging and training providers before production use.

**This is not end-to-end encryption:**
We do not claim end-to-end encryption. The AI must read message bodies to reply, so plaintext exists on our servers during inference. The encryption protects against database breaches and backup leaks, not against server-side processing.

**Passwords:**
User passwords are hashed with Argon2id using hardened parameters (`m=65536, t=3, p=1`).

## Operational Requirements

**Master key (`MASTER_KEK`) is critical:**
Loss of the master key means all user data is permanently unrecoverable. Back up `MASTER_KEK` in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) and keep it separate from your database backups.

**Verify OpenRouter before production:**
Before going live, confirm that the OpenRouter account's data policy excludes logging and training providers. This policy is displayed on the OpenRouter dashboard under Account → Privacy Settings.

**Crisis resources:**
The app detects crisis signals and displays hotline resources (988 for the US, findahelpline.com for international). This is an automated signal detection system and not a substitute for professional mental health care.
