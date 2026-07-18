# tellmewhy — Account Management: Deletion & Recovery

**Date:** 2026-07-18
**Status:** Draft for user review
**Parent:** docs/superpowers/specs/2026-07-05-tellmewhy-platform-design.md (the "deletion
by request → self-serve" IOU) · docs/superpowers/specs/2026-07-07-therapist-layer-design.md
(link lifecycle, key ownership, audit)

## What this is

The two promises the product has been carrying on credit: **self-serve account deletion**
(the README admits deletion is "on request" until this ships) and **password recovery**
(today a forgotten password is permanent lockout — crypto-shredding means there is no
admin workaround, and we never warned anyone). Plus the surface both need to live on: the
app currently has no account page and no sign-out anywhere.

## Password recovery (decision: email reset, via Resend)

**A password reset loses no data.** The user's DEK is wrapped by the server's `MASTER_KEK`,
not by their password — so unlike true E2EE products, recovery is an authentication
problem, not a cryptography problem. Refusing to offer it would be manufactured harshness,
not a privacy stance. We ship reset.

- **Transport:** Resend's plain HTTP API (`POST https://api.resend.com/emails`) called via
  `fetch` from a new `src/lib/email.ts` — no new package. Env: `RESEND_API_KEY`,
  `EMAIL_FROM`. Without a key (dev, test), the module runs a console-logging mock, mirroring
  the `AI_MOCK` posture; with a key it throws on non-2xx. It never logs recipient or body.
- **Flow:** better-auth's built-in reset (`/request-password-reset` → emailed link →
  `/reset-password`), enabled by providing `emailAndPassword.sendResetPassword` in
  `src/lib/auth.ts`. Token TTL: the better-auth default (1 hour). New pages:
  `/(auth)/forgot-password` (email input) and `/(auth)/reset-password` (new password, same
  10-char minimum as sign-up); "Forgot your password?" link on the sign-in form.
- **No enumeration:** the forgot-password page always answers with the same calm copy
  ("if that address has an account, a reset link is on its way") regardless of whether the
  account exists.
- **Email content honesty:** the email contains a link and nothing else — no name echoes,
  no content, nothing an inbox thief learns beyond "this address has a tellmewhy account"
  (which the reset feature inherently reveals to the inbox owner).
- **Abuse control:** better-auth's built-in `rateLimit` enabled with a custom window for
  `/request-password-reset`; Resend's free-tier daily cap is the outer bound.
- **On successful reset, all other sessions for the user are revoked** (a reset usually
  means "someone may have my password").

**Accepted risk (stated, not hidden):** sign-up never verifies email ownership. Someone
who signs up with an address they don't own has created an account the *real* inbox owner
can take over via reset. That is the correct failure direction — the inbox owner wins —
but it means reset makes email ownership load-bearing for the first time. Email
verification at sign-up is deferred, not rejected; the spec records it as the known gap.

## Account deletion (decision: shred + purge, immediate)

Deletion is the product's one true delete, and it must be worthy of the person clicking it
at 2am: instant, total, and honestly described.

### What "deleted" means (decision: purge rows, not just the key)

Shredding the DEK alone makes every ciphertext unreadable — but it would leave orphaned
rows whose *plaintext* columns still describe a person: message timestamps, `riskLevel`
flags (a crisis history!), conversation counts, mood-check-in days. The product's metadata
honesty cuts both ways: if we'd have to admit the ghost exists, don't leave a ghost.

So deletion = **shred the key AND purge the rows**, in one transaction:

1. **Verify the password** (Argon2id via `src/lib/password.ts` against `account.password`).
   Wrong password → generic failure, rate-limited (this is a credential-guessing surface).
2. **Write the audit lines** (`account_deleted`, a new audit action): one row per link
   partner (`actorId` = the deleter), or a single self-referential row if unlinked. Audit
   rows carry ids and times only and are designed to outlive their subject — they stay.
3. **Close the links** — for each `invited`/`active` link: status → `revoked`, `revokedAt`
   stamped, all `sharing_grants` for the link deleted (the same mechanics as a manual
   revocation), plus the departure marker (next section). Link **rows are kept**: deleting
   them would cascade away the surviving partner's own notes — their writing, their DEK,
   their record.
4. **Purge owned rows:** `conversations` (messages, digests, grants, review markers
   cascade), `folders`, `mood_checkins`, `self_notes`, own `exercise_entries`; for a
   client, their `exercises`; for a deleting therapist, their `notes` rows (therapist-DEK:
   already unreadable post-shred; rows are noise). `audit_events` are never purged.
5. **`shredUserKey(userId)`** — the existing, tested primitive gets its first caller.
6. **Delete the `user` row** — `session` and `account` cascade at the DB level, so every
   session on every device dies with the account.

Then the browser clears its state and lands on a brief, calm goodbye screen — signed out,
nothing to come back to, and the copy says exactly that.

**Both roles can delete.** The client path is primary; a therapist deleting follows the
same shape symmetrically (their notes are shredded and purged; client homework —
deliberately client-DEK per the phase-3 stance — survives untouched; clients see the link
close). One code path, role-aware purge list.

### The confirmation (decision: password + typed intent, no grace period)

- Re-enter the password, then an explicit acknowledgment step: calm, product-voice copy
  stating precisely what will be lost and that no one — including us — can bring it back.
  Then one final action.
- **No cooling-off period.** "When I ask to be gone, I'm gone" is the promise the copy has
  been making; a grace period would also require background scheduling the stack doesn't
  have. The typed-intent step is the guard against a 2am impulse mis-click; it is not, and
  should not be, a guard against a 2am decision.

### Mechanics guard: the re-keying trap

`getOrCreateUserDek` mints a *fresh* DEK when no row exists — correct at sign-up, a
disaster after a shred (a mid-flight request could quietly re-key a deleted user).
`fetchOrCreateUserDek` gains a guard: it only **creates** a key when the `user` row exists;
the read path is unchanged. Post-deletion there is no user row, so nothing can re-key.

### API

`DELETE /api/account` — session → zod body `{password}` → `deleteAccount(userId,
password)` in a new `src/lib/account-deletion.ts` (domain fn owns all checks, route is
transport, matching the revoke-link route's shape) → `204`. New tight rate limiter
(capacity ~3) in `src/lib/rate-limit.ts`.

## The therapist's farewell (decision: honest, quiet, once)

A client vanishing without a word reads as a bug — or a wound. When a linked client
deletes their account, the therapist's roster shows a quiet, one-time state: **"«Name»
deleted their account."** — acknowledged with a single action, then gone from the roster.

- **Schema:** `therapist_links` gains `departedAt` (timestamp), `departedNameCiphertext`
  (text), `departureAcknowledgedAt` (timestamp). The name snapshot is encrypted under the
  **surviving partner's DEK** — key-ownership law: from the moment of deletion it is the
  survivor's record, like the notes they keep. A resilient decrypt (existing per-row
  try/catch pattern) falls back to "A client".
- **Roster:** the therapist desk additionally fetches links with `departedAt IS NOT NULL
  AND departureAcknowledgedAt IS NULL` and renders the farewell card in the client list.
  Acknowledge: `POST /api/therapist/links/[linkId]/acknowledge-departure`
  (therapist-gated, 404-indistinguishable like every therapist route).
- **The therapist keeps their own notes** — already true mechanically (notes select links
  of any status and decrypt with the author's DEK); the notes surface uses the departed-name
  snapshot where the `user` row no longer exists.
- Symmetric case: a therapist deleting stamps the same marker on the client's side; the
  client's trust view shows the link closed with the same honest phrasing.

## The /account page (decision: full minimal surface)

One quiet page, both roles, twilight-journal voice:

- **Sign out** — `authClient.signOut` (net-new; the app has never had one).
- **Change password** — current + new, better-auth `/change-password` with
  `revokeOtherSessions: true`.
- **Delete account** — the flow above, styled as the grave, unhurried act it is; the
  existing two-step confirm patterns (notes "Let it go", rail hide-confirm focus
  management) are the interaction templates.
- Entry points: the chat rail and the therapist desk header gain an account affordance.
- All UI through the standing design-skills mandate (`frontend-design`,
  `make-interfaces-feel-better`, `transitions-dev`).

## Copy & honesty updates

- README privacy model + landing privacy/FAQ + `llms.txt`: deletion is now self-serve;
  describe exactly what it does (key shredded, rows purged, audit lines remain, a linked
  therapist keeps their own notes and a name-only farewell marker); password reset exists,
  and what it can and cannot do (it recovers access; it never decrypts anything for anyone
  else).
- `docs/DEPLOY.md`: `RESEND_API_KEY` + `EMAIL_FROM` env, Resend domain DNS (SPF/DKIM)
  setup note, and the launch-checklist line about deletion-by-request flips to pointing at
  the self-serve flow.

## Out of scope

Email verification at sign-up (recorded as the reset flow's known gap) · grace-period /
scheduled deletion · account export · email change · notification emails of any other kind
· admin tooling.

## Testing

The deletion test is the centerpiece — it proves the product's deepest promise:

- **Unit/integration** (`account-deletion.test.ts`): password gate (wrong → nothing
  happens); full-purge assertions — after deletion every owned row in every table is gone,
  `audit_events` + partner link rows + partner notes remain, `user`/`session`/`account`
  rows are gone; the no-re-key guard (post-shred DEK fetch for the deleted id never
  creates a row); therapist-symmetric deletion (client homework survives, therapist notes
  purged); farewell marker written with a name snapshot only the surviving partner's DEK
  can open (cross-key non-decryption proof, per the house rule); repeat deletion → 404;
  transactionality (a failure mid-purge leaves the account intact).
- **Recovery flow:** request → token → reset → sign-in with new password works, old
  sessions are revoked, expired/reused tokens fail; enumeration-free responses; email
  module mock-mode + non-2xx behavior; rate limit on request endpoint.
- **e2e:** sign-up → chat → delete → goodbye screen → sign-in fails. Two-context journey
  extension: client deletes → therapist sees the farewell card once, acknowledges it,
  still reads their notes. Forgot-password journey against the mock transport.
