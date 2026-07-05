# tellmewhy — Platform Design

**Date:** 2026-07-05
**Status:** Approved

## What this is

A platform for talking with AI securely about your feelings. The user chats as if with their therapist and gets an immediate AI reply. A real, trusted therapist can be linked to review those chats: a "review line" in the chat shows how far they've read, they can step into the conversation (visibly labeled as a human), and they can leave notes — private ones, hidden instructions to the AI, and public ones the client sees. All sensitive data is encrypted at rest.

## Product decisions

- **Both modes from day one**: standalone AI chat AND therapist-linked. The standalone experience is complete on its own; a therapist link is attachable/detachable at any point in a chat's life.
- **Mobile-first responsive web app.** No native app in v1 (no app-store friction; emotional conversations happen on phones).
- **Full TypeScript, Next.js monolith** (App Router): client UI, therapist dashboard, and API routes in one deployable.
- **LLM via OpenRouter** (Vercel AI SDK + OpenRouter provider, streaming), with the account/data policy pinned to **no-logging / no-training providers only**.

## Roles & linking

- Two roles: `client` and `therapist`.
- Self-serve client signup; therapist invites client via tokenized link (or client invites therapist).
- Link lifecycle: `invited → active → revoked`.
- One therapist per client in v1.

## Chat core

- Client ↔ AI streaming chat. Message senders: `client | ai | therapist | system`.
- **Review line**: per (conversation, therapist) marker — last-reviewed message + timestamp — rendered as a divider in the client's chat ("Reviewed by [therapist] up to here").
- **Therapist interventions**: the therapist can write into a shared conversation. The message is visibly labeled as coming from the human therapist (never disguised as AI — an ethical and, in the EU, legal requirement). The AI sees it in context for subsequent replies.
- **Notes**, three kinds:
  - `private` — therapist-only, client never sees.
  - `ai_instruction` — hidden from the client, injected into the AI's system context, versioned.
  - `public` — visible to the client.
- **"Flag for my therapist"** on any message — the client's symmetric counterpart to the review line.

## Trust & sharing

- **Granular sharing**: per-conversation grants to the linked therapist, revocable at any time. Default: nothing shared.
- **Audit log**: client-visible record of therapist access ("your therapist viewed this on …").
- **Adversarial invariant**: a therapist can never read an ungranted conversation — including indirectly via digests, audit endpoints, notifications, or exports. This invariant gets adversarial tests.

## Safety (phase 1, not optional)

- A risk check runs on every exchange.
- On crisis signals (self-harm/suicidal intent): the UI breaks the chat frame — crisis hotlines and grounding resources are shown — and any linked therapist is notified immediately, jumping the review queue.

## Enrichments (v1)

- **Mood check-ins**: 1-tap daily mood log (+ optional note) → feeds AI context and a therapist trendline.
- **AI session digests**: per-conversation summaries with anchors to notable messages (mood shifts, themes, risk signals) — what therapists actually review.
- **Homework / exercises**: therapist assigns an exercise; the AI weaves it into conversations and reports engagement back.

## Encryption model

- **Envelope encryption at the application layer**: each user has a data encryption key (DEK); all message bodies, note bodies, and mood notes are encrypted with AES-256-GCM before reaching Postgres. DEKs are wrapped by a key-encryption key (env-provided for MVP, behind a KMS-ready `KeyProvider` interface so AWS KMS/Vault can be swapped in without data migration).
- TLS in transit; disk encryption underneath as a second layer.
- **Crypto-shredding**: deleting a user destroys their DEK — every row they own becomes noise, including in old backups.
- **Never claim E2EE.** The LLM must read plaintext transiently to reply. The privacy page states exactly: encrypted at rest per-user, plaintext only in memory during inference, zero-retention LLM providers only.

## Stack

- Next.js (App Router) + TypeScript
- Postgres + Drizzle ORM
- pg-boss for background jobs (digest generation, risk escalation, notifications)
- Better Auth; passwords hashed with Argon2id (hardened parameters)
- Tailwind + shadcn/ui, mobile-first
- AI output rendered through a streaming-safe markdown library

## Build order

Each sub-project gets its own spec → plan → implementation cycle:

1. **Foundation** — auth/roles, encrypted data layer, streaming AI chat, crisis detection + resources, mobile-first UI. Ships as a usable standalone product.
2. **Therapist layer** — invites/linking, sharing grants + revocation, review line, labeled interventions, all three note types, AI instructions, audit log, crisis notifications to therapist.
3. **Enrichments** — mood check-ins, digests, homework.

## Testing

- Vitest units: encryption round-trips, crypto-shredding, review-marker logic, sharing-grant enforcement.
- Playwright e2e: signup → chat → streamed reply; crisis frame-break; therapist review flow.
- Sharing-grant enforcement tested adversarially.

## v2 backlog (deferred, not forgotten)

- Native mobile apps + push notifications
- Multi-therapist per client
- Billing / therapist marketplace
- Group features / therapist-to-therapist referrals
- Self-hosted open models
- Themes/patterns dashboard for therapists (beyond the mood trendline)
