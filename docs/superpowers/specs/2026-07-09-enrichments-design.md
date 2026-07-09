# tellmewhy — Enrichments (Phase 3) Design

**Date:** 2026-07-09
**Status:** Approved
**Parent spec:** `2026-07-05-tellmewhy-platform-design.md` §Enrichments

## What this is

Phase 3 makes the therapist link *clinically useful* and the standalone product *self-reflective*: AI session digests (what therapists actually review), one-tap mood check-ins (the "How the weeks have felt" rail placeholder becomes real), and homework/exercises — founded on the CBT **thought record** (diary of thoughts, emotions, physiological and behavioral reactions: trigger situation → thoughts → emotions → behavior).

All three ship in one spec → plan → execution cycle (user decision).

## Product decisions (user-approved)

1. **Digests are on-demand and cached** — generated when a therapist opens a shared conversation and the digest is stale, never in the background. No job queue, no new packages, no tokens burned on conversations nobody reviews.
2. **Exercises are both a structured worksheet form AND an AI-guided chat path** — two ways to produce the *same structured entry*.
3. **Mood sharing is an explicit opt-in toggle on the Trust screen, default OFF** — consistent with "default: nothing shared".
4. **Homework reports engagement automatically; content is shared per-entry by the client** — one non-coercive prompt at save time, decline leaves it private forever.

## Decisions argued here (controller calls)

- **Digest key ownership: the CLIENT's DEK, served through THE GATE.** A digest derives 100% from client message content — it is the client's data wearing a summary hat. Client-DEK keeps both standing laws intact: crypto-shredding the client destroys the digest; revoking the grant makes it unreachable (gate). Therapist-DEK would mean the client cannot read a summary of their own words, and revocation semantics would blur.
- **Mood trend shared = scores + dates only; note contents NEVER ride along.** The toggle's label says exactly that.
- **Thought records exist without a therapist.** Standalone completeness is a founding law: self-guided entries use the same form, the same AI walk-through, the same entry type. "Homework" is only the therapist-assigned wrapper.
- **Assignment is link-level, not grant-level.** Assigning an exercise requires an active link (like AI-instruction plumbing) but no per-conversation grant — the assignment is client-visible content, not covert steering.
- **Homework joins the AI's system prompt un-gated.** Active assignments are the client's own visible data; injecting them into the client's own chats needs no grant check. The crisis addendum stays LAST, always.

## Data model (four new tables)

All content columns are AES-256-GCM ciphertext (`v1.` envelope format) under the **client's DEK**. Plaintext columns are ids + times + enums only — the same discipline as audit.

- **`mood_checkins`** — `id, user_id, day (date), payload_ciphertext, created_at, updated_at`. Unique `(user_id, day)`; a repeat check-in on the same day updates the row. Payload: `{score: 1–5, note?: string}`. Trendline aggregation happens app-side after decryption (≤1 row/day — trivial volume, and mood never joins the plaintext-metadata list).
- **`digests`** — `id, conversation_id (unique), body_ciphertext, covers_up_to_message_id, generated_at`. Latest-only: regeneration replaces the row. Body JSON: summary sections + anchors `[{messageId, label}]`; excerpts may live inside the body because the whole body is ciphertext.
- **`exercises`** — `id, link_id, client_id, type ('thought_record'), instruction_ciphertext, status ('active' | 'closed'), created_at`. Instruction text is therapist-authored but client-visible → client DEK (same law as interventions). Type is an extensible enum; v1 ships `thought_record` only.
- **`exercise_entries`** — `id, user_id, exercise_id (nullable — null = self-guided), payload_ciphertext, shared_at (nullable), created_at`. Payload: the worksheet columns — `{situation, thoughts, emotions, behavior, bodySensations?, occurredAt?}`. `shared_at` null = private; set = the assigning therapist may read this one entry.

## Feature 1 — AI session digests

**Trigger:** therapist opens a shared conversation's reading view. The server — already past `requireGrantedConversation` — compares the newest message id to `covers_up_to_message_id`. Stale or missing → regenerate behind a calm "Preparing digest…" state: one LLM call (no-logging OpenRouter settings, output-capped, `AI_MOCK`-mockable) over the prior digest body + the messages since `covers_up_to_message_id` (first generation: the full conversation) — incremental, so cost stays bounded on long conversations — then encrypt with the client's DEK and replace the row.

**Render:** a digest panel above the messages in the reading view — themes, notable moments, risk signals. Each anchor click scrolls to its message with the same gentle landing the crisis navigator uses. Crisis-related digest content wears warm amber, never red.

**The invariant, adversarially tested:** ungranted/revoked ⇒ no digest exists, ever. Generation AND reads sit behind the gate; "digest exists, then grant revoked → 404" gets an explicit test. A digest can never be a side channel into an ungranted conversation.

**Failure honesty:** if the LLM call fails, the reading view renders normally with a quiet "digest unavailable right now" note — never a fake or stale-presented-as-fresh summary. A stale digest that fails to regenerate shows *as stale* ("covers up to …").

## Feature 2 — Mood check-ins

**Client:** a one-tap check-in (5 mood levels + optional short note) on the home screen and the stats rail. The "How the weeks have felt" placeholder becomes a real sparkline of the last ~8 weeks. Checking in twice in a day updates that day.

**AI context:** the last ~14 days of check-ins, summarized to one compact line, join the chat system prompt (before any therapist guidance, and always before the crisis addendum) so the AI has continuity ("you've marked the last few days heavy").

**Therapist:** the Trust screen gains one toggle — "Share my mood trend (scores and dates only, never your notes)" — default OFF. On: the therapist's desk shows the client's trendline (scores + dates). Off or link revoked: nothing, instantly. The toggle state lives on the therapist link row (`mood_shared_at` nullable timestamp), so revoking the link kills it structurally.

## Feature 3 — Homework / exercises (thought record)

**Therapist (desk):** assign an exercise — type + instruction text — to the linked client; requires an active link. Sees engagement automatically: entry count and last-entry date (ids + times only). Reads an entry's content only when `shared_at` is set. Closing an assignment stops the AI weaving but never touches entries.

**Client:** an active assignment appears on the home screen and as a quiet chat affordance. Two completion paths, one entry shape:

- **Worksheet form** — a focused, mobile-first screen mirroring the paper columns: trigger situation (+ when), thoughts ("they probably think I'm an idiot"), emotions (anxiety, anger, shame, disgust…), behavior (e.g. avoiding the situation), optional body sensations.
- **AI-guided in chat** — "walk me through it": the AI asks one column at a time inside a normal conversation; on completion the structured entry is extracted (`AI_MOCK`-deterministic) and saved identically. The crisis classifier keeps running on every client message — a walk-through is still a chat.

**Sharing:** at save time, one non-coercive prompt: "Share this entry with [therapist name]?" Decline = private forever (still counted in engagement). Share = `shared_at` set; the therapist can read that entry. Self-guided entries (no therapist, or none assigned) skip the prompt entirely.

## Cross-cutting

- **README Privacy Model additions (honest, exact):** digests are AI-derived content — plaintext transits the LLM at generation time, like replies; mood scores are encrypted at rest and leave the client's view only via the explicit toggle (scores + dates, never notes); exercise entries are private by default and shared one entry at a time.
- **Stats rail:** "How the weeks have felt" goes live (drop its `SoonPill`); the remaining "Notes to your future self" placeholder stays honestly labeled.
- **No new packages.** On-demand digests need no queue; everything runs on the existing stack.
- **Rate limiting:** digest generation and AI-guided exercise turns ride the existing per-user limiter patterns; exercise CRUD gets bounded input sizes like every other route.

## Testing

- **Crypto:** ciphertext-at-row + cross-key non-decryption for all four tables.
- **Adversarial gate:** digest pre-grant/post-revoke 404s (including "digest already existed"); mood trend with toggle off / on / after link revoke; unshared entry invisible to the therapist while engagement counts it; foreign-client assignment attempts 404.
- **Behavior:** staleness triggers exactly on new messages; same-day mood upsert; entry extraction from the AI-guided path; crisis addendum remains last with mood + homework sections present.
- **e2e:** mood tap → sparkline appears; thought record via form → entry listed; assignment → completion → share → therapist reads it; digest renders and an anchor jump lands.

## Non-goals (v2 backlog)

- Digest history/versions (latest-only in v1) · scheduled or push mood reminders · exercise types beyond the thought record · therapist-authored custom form schemas · mood-note sharing in any form · background digest generation (revisit with a queue if on-demand latency ever hurts).
