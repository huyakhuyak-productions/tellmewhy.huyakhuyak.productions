# tellmewhy — v1 Close-out (Phase 4) Design

**Date:** 2026-07-12
**Status:** Approved
**Parent spec:** `2026-07-05-tellmewhy-platform-design.md`
**Sibling input:** `.superpowers/sdd/p3-minors-triage.md` (the phase-3 next-sweep ledger)

## What this is

Phase 4 finishes v1: the last honestly-labeled placeholder ("Notes to your
future self") becomes real, the audit feed stops under-reporting shared-record
reads, and the ~20 minors triaged NEXT SWEEP during phase 3 get fixed or
formally accepted. After this phase, every surface the product shows is live
and every ledgered debt is either paid or recorded as a deliberate decision.
No new subsystems (dashboards, notifications, native apps) — those remain v2.

## Product decisions (user-approved)

1. **Phase 4 = v1 close-out** — notes feature + audit granularity + hardening
   sweep, nothing from the v2 backlog.
2. **Notes come from two paths** — "keep this" on any chat message AND a
   free-form composer. Same note shape either way.
3. **Audit is per-entry** — reading three shared records writes three audit
   lines. Requires a subject-id column on the audit table.

## Feature 1 — Notes to your future self

The rail placeholder promised: *"Lines worth remembering will be set aside
here for the next hard night."* That promise, made real.

### Privacy stance (hard law)

Notes are private, period. **No share path, no therapist visibility by any
route, and notes never join the AI's system prompt.** They are for the
human's future self, not the model and not the therapist. This is the one
content type with zero consent surface because there is nothing to consent
to. Adversarially tested like every other boundary.

### Data model

One new table, **`self_notes`**:

- `id` — uuid pk
- `user_id` — `text`, no FK (the repo-wide pattern for user-id columns:
  the dev database holds orphaned smoke-test user ids a FK would reject —
  see `conversations.userId`; account deletion is crypto-shredding, which
  makes orphaned rows unreadable noise)
- `body_ciphertext` — AES-256-GCM under the **owner's DEK** (`v1.` envelope)
- `source_message_id` — nullable FK → messages, **on delete set null**.
  Null = self-written; set = kept from chat. (Same nullable-provenance
  pattern as `exercise_entries.exercise_id`.)
- `created_at`

Plaintext columns are ids + times only — the standing discipline. Deleting a
note is a hard row delete (it is the owner's own data; crypto-shredding
covers account deletion as usual).

### Two entry paths, one shape

- **Keep from chat** — a quiet "Keep this" action on the existing per-message
  affordances (works on the client's own messages and the AI's). Saves that
  message's full text as the note body, linked via `source_message_id`.
  No text selection in v1 — whole message, display-clamped.
- **Write your own** — a small composer on the notes screen. Bounded input
  size like every other write route.

### Surfaces

- **Stats rail:** the panel drops its `SoonPill` (the last one) and shows the
  most recent few notes, clamped, linking to the notes screen. Empty state
  keeps the current promissory line as a gentle hint, minus the pill.
- **`/notes` screen:** full list (newest first), the composer, per-note
  delete with an inline confirm (same pattern as End connection). Kept-from-
  chat notes show a quiet provenance hint; if the source message is gone the
  note simply stands alone (set-null).
- **Mobile:** `/notes` is reachable the same way `/exercises` is.

### Routes

- `POST /api/notes` — `{body}` (self-written) or `{messageId}` (keep from
  chat; server reads the message — ownership-checked — and copies its text).
  Rate-limited like other client writes; `ValidationError` → 400, else 500.
- `GET /api/notes` — owner's notes, decrypted server-side, newest first.
- `DELETE /api/notes/[noteId]` — owner-only; foreign/missing → 404
  indistinguishable.

## Feature 2 — Per-entry audit honesty

Migration adds a nullable **`subject_id`** (uuid, no FK — it may reference
rows of different types and must survive their deletion) to the audit table.
`entry_viewed` writes set `subject_id` = the entry id, and dedup becomes
**per (therapist, client, action, subject)** within the existing dedup
window, instead of client-wide. Existing rows keep `subject_id` null.

The trust feed keeps its exact content-absence law: ids + times only, one
line per entry read. Other actions are unchanged (`mood_trend_viewed` is
inherently client-wide; conversation views already carry their scope).

## Feature 3 — The hardening sweep

Every NEXT SWEEP item from `.superpowers/sdd/p3-minors-triage.md` plus the
post-gate ledger additions, with verdicts:

### Fix — concurrency & lifecycle

1. Digest staleness race → conditional set (regeneration only replaces the
   row if `covers_up_to_message_id` would advance; no regression under
   concurrent opens).
2. `shareEntry` TOCTOU → conditional `UPDATE … WHERE shared_at IS NULL`;
   audit written only when the update took effect (no double-audit, no
   timestamp shift).
3. Walk-through seed append made idempotent (double-click adds one seed).
4. Mood saved-flash `setTimeout` cleaned up on unmount.

### Fix — log hygiene (earlier phases join the phase-3 law)

5. Sweep the pre-phase-3 catch sites (conversations, sharing,
   therapist-access, therapist-notes, digest `tryDecryptBody`) to the
   established discipline: ids + `error.name: error.message` only, never the
   raw error object. Sentinel tests where a new pattern is introduced.

### Fix — behavior minors

6. `GET /api/mood?days=` (empty string) → treated as absent → default 56.
7. **Mood upsert becomes note-preserving:** a check-in payload without a
   note no longer clears an existing note for that day (fixes the
   cross-device stale re-tap data loss). Sending an explicit empty note
   still clears — deleting your own note stays possible.
8. Cached/stale digest return paths re-run the anchor filter against the
   current message set (a dangling anchor can never reach the therapist,
   even after message deletion).
9. The chat route's homework ordering (newest-first, active + live-link
   only) is pinned as a route-level contract by a route test — a reorder
   in `listExercisesForClient` fails the chat route's own suite. (Shipped
   as a test-pinned contract rather than a redundant in-route sort.)
10. Mood + exercise context loads in the chat route run concurrently.

### Fix — copy, comment & a11y truth

11. Worksheet save surfaces the 429 pacing message instead of uniform copy.
12. Share-prompt copy stops suggesting retry once the link is revoked
    (stale-live-link window).
13. The two worksheet-form comments (~83, ~151) falsely claiming
    prefilled-from-chat never sees the share prompt — corrected.
14. "Drawn from your conversation" disclosure shown on ATTACHED prefilled
    drafts too.
15. "(Task N)" comments in earlier-phase files (therapist conversations
    route ~15, hero-composer ~79, therapist-desk ~1) made self-contained.
16. Stale "no anchors" comment in `e2e/therapist.spec.ts` (~179) removed.
17. README mood lead-sentence vs body tension resolved.
18. Compose-submit tooltip shows a platform-aware glyph (⌘↵ on mac,
    Ctrl+↵ elsewhere).
19. "Digest unavailable" rendered outside the disabled button so it is
    reachable in the tab order / by screen readers.
20. `closeError` becomes per-card in the exercise panel.

### Fix — e2e robustness

21. Digest `getByRole("button").first()` replaced with an accessible-name
    selector.
22. Adversarial spec asserts a pre-revoke 200 on the constructed digest URL
    before asserting the post-revoke 404 (proves the 404 is revocation, not
    a bad URL).

### Accepted as-is (recorded, closed)

- **Homework newline posture** matches `ai_instruction` — both interpolate
  therapist-authored text as-is; the therapist is inside the trust model and
  the crisis addendum is structurally last. Decided once, for both.
- **UTC mood-day boundary** — client-local day is a real feature (needs a
  validated client-supplied date), deferred to the v2 backlog, not a sweep
  patch.
- **`tellmewhy:` draft keys tab-scoped** — repo-wide precedent including
  chat drafts; revisit only with a sign-out sweep design.
- **Revoke coverage living in the journey tail** — the journey is the
  canonical revocation proof; duplicating it in the dedicated spec buys
  nothing.
- **Sparkline `preserveAspectRatio` dot squish** — disclosed, imperceptible.
- **Risk-anchor hover no-op / card `outline-none`** — flat-by-design;
  the "Closed" chip conveys state.
- **Therapist write limiter consuming before validation** — test-pinned
  deliberate contract since phase 3.
- **Compose-submit predicate without `isComposing`/`altKey` exclusions** —
  adjudicated harmless in the phase-3 increment.

## Cross-cutting

- **No new packages.**
- **Key ownership:** note bodies under the owner's DEK — the only actor who
  can ever read them.
- **README Privacy Model addition (honest, exact):** notes to your future
  self are encrypted at rest and visible to no one but you — they are never
  shared with a therapist and never enter the AI's context.
- **Rate limiting:** notes writes ride the existing per-user write-limiter
  pattern (10/5min, same as entries).

## Testing

- **Crypto:** ciphertext-at-row + cross-key non-decryption for `self_notes`.
- **Adversarial:** therapist can never reach a note by any route (list,
  read, guess-the-id) — 404 indistinguishable; notes absent from the chat
  system prompt (total-order test extended to assert absence).
- **Audit:** N shared records read → N `entry_viewed` lines with distinct
  subjects; re-read of the same entry inside the dedup window → no
  duplicate; legacy null-subject rows still render.
- **Concurrency:** conditional digest set and conditional share tested with
  interleaved calls.
- **Behavior:** note-preserving mood upsert (absent vs explicit-empty note);
  keep-from-chat copies exact text and survives source-message deletion;
  empty-string `days=` default.
- **e2e:** keep a line from chat → rail shows it → `/notes` lists it with
  provenance; write-own note; delete with confirm; therapist reads two
  shared records → client feed shows two lines.

## Non-goals (backlog)

Note editing · AI resurfacing of notes ("on a hard night…") · reminders/push
· note sharing in any form · client-local mood day · text-selection keeps ·
notes search/folders.
