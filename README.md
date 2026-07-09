# tellmewhy

A mobile-first web app for talking with an AI about your feelings. Messages are encrypted at rest, and every conversation is encrypted before reaching the database. Conversations can be organized into folders, filterable from the home screen and grouped in the chat rail. Crisis signals trigger a detection system that shows crisis resources (988, findahelpline.com). This is not a medical device and not a replacement for professional care. You can link one trusted person — a therapist, or anyone else — to read conversations you choose to share, leave you notes, and guide how the AI responds; see [Linking a trusted person](#linking-a-trusted-person). On desktop, the hero home page and chat view expand into a three-zone frame — a folder-grouped conversation rail on the left and a stats rail on the right flank the chat column.

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

## Linking a trusted person

A client can invite one trusted person — a therapist, or anyone else — to read the conversations they choose to share.

- From `/trust`, generate a single-use invite link and send it to the person you trust. They sign up (or sign in) and accept it. From that point they're your one linked person; you can't have a second active link at the same time.
- Sharing is per-conversation and opt-in. Nothing is visible to your trusted person until you share a specific conversation from its header, and revoking that share removes their access to it immediately.
- Once you've shared a conversation, your trusted person can read it, mark how far they've read, send you a message as themselves — always labeled with their name, never mistaken for the AI — and leave standing guidance that shapes how the AI responds in conversations you've shared with them.
- Revoke the whole link at any time from `/trust` to end the relationship entirely: your trusted person immediately loses access to every conversation, past and future.
- `/trust` also shows a plain audit trail of what your trusted person has done — read, marked, wrote to you, published a note — with a timestamp for each, so you always know what happened even if you weren't looking.

## Privacy Model

**Per-user envelope encryption at rest:**
Every message body and conversation title, and every folder name, are encrypted with AES-256-GCM using a per-user data encryption key (DEK). DEKs are wrapped by a master key (`MASTER_KEK`) before being stored. This means that without the master key, no message is readable—even with database access. The wrapping goes through a swappable `KeyProvider` interface, so a KMS/Vault-backed provider can replace the env-based master key in production without re-encrypting any data.

**Crypto-shredding on deletion:**
Destroying a user's wrapped-key row is the designed mechanism for account deletion: it immediately and permanently renders that user's data unreadable going forward. The underlying function (`shredUserKey`) is implemented and tested but is not yet wired to a user-facing deletion flow—self-serve account deletion ships with the account-management phase. Note that a database backup taken *before* the key row is destroyed still contains the wrapped DEK and remains decryptable with `MASTER_KEK`; shredding only guarantees unreadability going forward, unless the master key is rotated or key rows are excluded from backup retention.

**Plaintext exists only in memory:**
Message bodies exist as plaintext only during request handling and during AI inference. After inference completes, the plaintext is discarded and only the ciphertext is stored. Message timestamps and risk-level flags are not encrypted—a database breach would reveal when conversations happened and which messages were flagged as crisis-level, but never their content.

**OpenRouter data policies:**
All LLM calls route through OpenRouter with strict per-request `data_collection: "deny"` headers. The OpenRouter account's global data policy must be configured to exclude logging and training providers before production use.

**This is not end-to-end encryption:**
We do not claim end-to-end encryption. The AI must read message bodies to reply, so plaintext exists on our servers during inference. The encryption protects against database breaches and backup leaks, not against server-side processing.

**Sharing with a trusted person is not end-to-end encrypted, either:**
Sharing means our server decrypts a conversation with your key to show your trusted person — access-controlled and audit-logged, not a private channel between the two of you. Every read and write on a shared conversation is gated by an explicit, per-conversation grant; revoking that grant (or ending the link entirely) removes their access immediately, to past and future messages alike.

**Notes are owned by their author, not their subject:**
Anything your trusted person writes about you — private notes, guidance for the AI, or notes they publish for you to read — is encrypted with *their* key, not yours. Deleting their account crypto-shreds their notes independently of your data; it doesn't touch anything you wrote.

**The audit trail is metadata, not a transcript:**
`/trust` logs every time your trusted person reads a shared conversation, marks their place, writes to you, or publishes a note. That log records who did what and when — never what they read or what they wrote. It cannot substitute for actually reading your shared conversations yourself.

**Passwords:**
User passwords are hashed with Argon2id using hardened parameters (`m=65536, t=3, p=1`).

## Operational Requirements

**Master key (`MASTER_KEK`) is critical:**
Loss of the master key means all user data is permanently unrecoverable. Back up `MASTER_KEK` in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) and keep it separate from your database backups.

**Verify OpenRouter before production:**
Before going live, confirm that the OpenRouter account's data policy excludes logging and training providers. This policy is displayed on the OpenRouter dashboard under Account → Privacy Settings.

**Crisis resources:**
The app detects crisis signals and displays hotline resources (988 for the US, findahelpline.com for international). This is an automated signal detection system and not a substitute for professional mental health care.
