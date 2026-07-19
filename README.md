# tellmewhy

**A private place to talk about how you feel.** Message an AI that answers now, and — if you ever want one — a single trusted person who reads only what you choose to share.

A mobile-first web app for talking with an AI about your feelings. Messages are encrypted at rest, and every conversation is encrypted before reaching the database. Conversations can be organized into folders, filterable from the home screen and grouped in the chat rail. Crisis signals trigger a detection system that shows crisis resources (988, findahelpline.com) and, in shared conversations, surfaces the message in the trusted person's attention queue the next time they look — it never pushes an alert. This is not a medical device and not a replacement for professional care. You can link one trusted person — a therapist, or anyone else — to read conversations you choose to share, leave you notes, and guide how the AI responds; see [Linking a trusted person](#linking-a-trusted-person). On desktop, the hero home page and chat view expand into a three-zone frame — a folder-grouped conversation rail on the left and a stats rail on the right flank the chat column.

## Features

- **Streaming AI chat** with markdown rendering, stop-generation that keeps the honest partial, and copy-to-clipboard.
- **Branching conversations, ChatGPT-style** — edit any of your messages into a new version, regenerate any reply, and flip between versions with `‹ n/m ›` switchers. Nothing is ever destroyed; every branch stays reachable.
- **Folders and hiding** — organize conversations into folders; hide a conversation from your own view and restore it any time.
- **Mood check-ins** with a trendline, **thought records** (CBT-style, shareable per-entry), and **notes to your future self** (never shared, never read by the AI).
- **The trusted-person layer** — invite one therapist (or anyone you trust), share conversations one at a time, see their review line in your chat, receive their messages always labeled as human, and read a full audit trail of everything they did.
- **Crisis detection** that surfaces hotline resources in the moment and, in shared conversations, a grant-gated attention queue for your trusted person — pull, never push.
- **Per-user envelope encryption at rest** for every message body, title, folder name, note, and check-in — see [Privacy Model](#privacy-model) for exactly what that does and doesn't protect.

## Tech Stack

Next.js 16 (App Router) · React 19 · TypeScript · Bun · Postgres 17 · Drizzle ORM · Better Auth (Argon2id) · Vercel AI SDK v6 + OpenRouter · Tailwind CSS v4 · Vitest + Playwright

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
- `/trust` also shows a plain audit trail of what your trusted person has done — accepted your invite, read, marked their place, wrote to you, published a note, checked on your flagged messages — with a timestamp for each, so you always know what happened even if you weren't looking.
- Accepting an invite marks that person as a therapist going forward — including the ability to send invites of their own — even after every link they've ever had is revoked; it's your grants, not their role, that control what they can actually see.

## Privacy Model

**Per-user envelope encryption at rest:**
Every message body and conversation title, and every folder name, are encrypted with AES-256-GCM using a per-user data encryption key (DEK). DEKs are wrapped by a master key (`MASTER_KEK`) before being stored. This means that without the master key, no message is readable—even with database access. The wrapping goes through a swappable `KeyProvider` interface, so a KMS/Vault-backed provider can replace the env-based master key in production without re-encrypting any data.

**Crypto-shredding on deletion:**
Deleting your account is self-serve, from the `/account` page: re-enter your password, acknowledge what's about to happen, and in a single transaction your data-encryption key is tombstoned (its wrapped form nulled and stamped so nothing can ever re-key you) and every row you own—conversations, messages, folders, mood check-ins, self-notes, exercises, entries—is purged. Crypto-shredding the key renders any remaining ciphertext permanently unreadable, by anyone, including us; the row purge means we don't even keep the plaintext metadata (timestamps, risk flags) that a shred-the-key-only approach would strand. Two things survive by design: append-only `audit_events` carrying ids and times but never content (they outlive their subject), and, for a departing user who had linked a trusted person, that partner's own notes plus a name-only departure marker encrypted under the *partner's* key—their record, not yours; a long-revoked ex-partner learns nothing and keeps no name snapshot. Every session on every device ends with the account. One honest caveat unchanged by any of this: a database backup taken *before* the key is destroyed still contains the wrapped DEK and remains decryptable with `MASTER_KEK` until it ages out of backup retention or the master key is rotated.

**Password reset restores access, never content:**
A forgotten password is recoverable by email (better-auth + Resend): request a link from `/forgot-password`, set a new password, done. Because your DEK is wrapped by the server's `MASTER_KEK` and not by your password, a reset is an authentication step, not a decryption one—it restores your ability to sign in and read your *own* data, and it exposes nothing to anyone else. The email carries a link and nothing more (no name, no content); the same calm response is returned whether or not the address has an account, so it can't be used to enumerate users; and every other session is revoked on reset. Known gap: email is not verified at sign-up, which makes inbox ownership load-bearing for reset—sign up with an address you control.

**Plaintext exists only in memory:**
Message bodies exist as plaintext only during request handling and during AI inference. After inference completes, the plaintext is discarded and only the ciphertext is stored. Message timestamps and risk-level flags are not encrypted—a database breach would reveal when conversations happened and which messages were flagged as crisis-level, but never their content. The same is true of a message's `flaggedAt` (when a client flagged it for their trusted person) and `authorId` (which user actually wrote it), and of the therapist-link and audit-event tables as a whole: who is linked to whom, when, and what they did (invited, accepted, revoked, viewed a conversation, wrote a note) is plaintext relationship metadata—a breach reveals the shape of who's connected to whom and what happened between them, never any message content.

**OpenRouter data policies:**
All LLM calls route through OpenRouter with strict per-request `data_collection: "deny"` headers. The OpenRouter account's global data policy must be configured to exclude logging and training providers before production use.

**Analytics, deliberately minimal:**
Page views are counted with a self-hosted, cookieless Umami instance (`UMAMI_SCRIPT_URL` + `UMAMI_WEBSITE_ID`; with either unset, no analytics script renders at all). What it collects is paths and visit metadata on our own infrastructure — no cookies, no third party, never message content. Tracked URLs are scrubbed before anything leaves the page: query strings are never sent (`data-exclude-search` — a password-reset token rides in one), invite-link paths are redacted to `/link/redacted` by a `data-before-send` hook, and referrer query strings are dropped (an encoded token can ride in `?next=`). What reaches the analytics DB is paths with opaque ids only — the same only-hashes-never-raw-tokens rule the app database follows.

**This is not end-to-end encryption:**
We do not claim end-to-end encryption. The AI must read message bodies to reply, so plaintext exists on our servers during inference. The encryption protects against database breaches and backup leaks, not against server-side processing.

**Sharing with a trusted person is not end-to-end encrypted, either:**
Sharing means our server decrypts a conversation with your key to show your trusted person — access-controlled and audit-logged, not a private channel between the two of you. Every read and write on a shared conversation is gated by an explicit, per-conversation grant; revoking that grant (or ending the link entirely) removes their access immediately, to past and future messages alike.

**Hiding a conversation changes only your own view:**
Hiding a conversation tucks it out of your own home screen and rail—nothing more. It stays encrypted at rest exactly as before, and if you've shared it, your trusted person still sees it under their live grant. Its messages still inform the AI's replies and any digest of a shared conversation; hiding is neither unsharing nor deletion. You can restore a hidden conversation to your own view at any time.

**Notes are owned by their author, not their subject:**
Anything your trusted person writes about you — private notes, guidance for the AI, or notes they publish for you to read — is encrypted with *their* key, not yours. Deleting their account crypto-shreds their notes independently of your data; it doesn't touch anything you wrote.

**Digests are AI-derived content, not a separate secret:**
A session digest is produced by the same LLM that writes replies. To summarize a shared conversation, our server decrypts it under your key and sends the plaintext to the model — exactly as it does to generate a reply. The digest is AI-derived content, stored encrypted at rest like any message body, and it is only ever shown to a trusted person you've actively shared that conversation with; revoking the share (or ending the link) removes their access to the digest along with the conversation. Like replies, this is not end-to-end encrypted: plaintext exists on our servers during generation.

**Mood scores and their dates — never the notes — leave your view only by an explicit toggle:**
Your mood check-ins are encrypted at rest with your key, the same as messages. And like your messages, your recent check-ins — scores and any notes — are read into your own AI companion's context so it can meet you where you are, which means their plaintext transits the model during a reply, exactly as message bodies do. The toggle in `/trust` governs something different: what your trusted person sees. Nothing reaches them until you turn it on, and even then only the scores and their dates leave your view — never the private note you may attach to a check-in. Turning the toggle off removes the trend from your trusted person's view immediately, indistinguishable from never having shared it at all.

**Thought-record entries are private by default and shared one at a time:**
A thought record you write is private until you choose to share that specific entry. Sharing is per-entry, never all-or-nothing, and a self-guided record can't be shared at all. Your trusted person can see whether you've engaged with an assignment they gave you — a count of entries and how recently, never the words — but can read only the individual entries you explicitly shared, and only under a live link. Revoking the link ends that access to past and future entries alike.

**Notes to your future self are yours alone:** encrypted at rest under your own
key, never visible to your trusted person by any route, and never part of what
the AI reads. There is no sharing toggle because there is nothing to share.

**The audit trail is metadata, not a transcript:**
`/trust` logs every time your trusted person reads a shared conversation, marks their place, writes to you, publishes a note, or checks on your flagged messages. That log records who did what and when — never what they read or what they wrote. It cannot substitute for actually reading your shared conversations yourself.

**Passwords:**
User passwords are hashed with Argon2id using hardened parameters (`m=65536, t=3, p=1`).

## Operational Requirements

**Master key (`MASTER_KEK`) is critical:**
Loss of the master key means all user data is permanently unrecoverable. Back up `MASTER_KEK` in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) and keep it separate from your database backups.

**Verify OpenRouter before production:**
Before going live, confirm that the OpenRouter account's data policy excludes logging and training providers. This policy is displayed on the OpenRouter dashboard under Account → Privacy Settings.

**Crisis resources:**
The app detects crisis signals and displays hotline resources (988 for the US, findahelpline.com for international). In a shared conversation, a crisis-flagged message is also surfaced in the trusted person's attention queue the next time they look — the app never pushes an alert. This is an automated signal detection system and not a substitute for professional mental health care.

## Deployment

The app ships as a Dockerfile deploy (Bun build stage → Next standalone server on slim Node) with migrations run automatically before each release. See [docs/DEPLOY.md](docs/DEPLOY.md) for the full Dokku runbook: one-time setup, first deploy, TLS, and the launch checklist.

## License

[AGPL-3.0](LICENSE). If you run a modified copy of tellmewhy as a service, you must make your modified source available to its users.
