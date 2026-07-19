# Road to "completed"

Three bars, in order. Status as of 2026-07-19 (phase 5 gate-closed, repo
public, deploy config shipped and reviewed — see `docs/DEPLOY.md`;
account-management phase shipped — self-serve deletion + email password reset).

## Bar 1 — It's live

- [ ] Run the Dokku runbook (`docs/DEPLOY.md`): one-time setup → first
      deploy → TLS, then the post-deploy verification pass (streaming
      through nginx, DB rows are ciphertext).
- [ ] Launch checklist:
  - [ ] Verify the OpenRouter account-level data policy excludes
        logging/training providers (the per-request `deny` needs this
        backstop for the public copy to be true).
  - [ ] Schedule Postgres backups; confirm `MASTER_KEK` is saved in the
        password manager (the runbook prints it).
  - [ ] Set `RESEND_API_KEY` + a Resend-verified `EMAIL_FROM` (SPF/DKIM) so
        password reset can send — production refuses to send without them.
        Deletion is self-serve now, so there's no by-request queue to staff.

## Bar 2 — v1 is honestly complete

- [x] **Account-management phase** (spec → plan → build, the usual cycle):
  - [x] Self-serve account deletion — shipped at `/account`: password +
        acknowledgment → one transaction that shreds the DEK (tombstoned, so
        nothing can re-key), purges every owned row, writes ids-and-times
        audit lines, closes still-active links with a survivor-encrypted
        name-only departure marker, and ends all sessions. Entry points on
        the chat rail, chat home footer, and therapist desk header; a
        surviving partner sees a one-time farewell card. The IOU is off the
        books — the public copy now says so.
  - [x] Password recovery — shipped: email reset via better-auth + Resend
        (`/forgot-password` → link → `/reset-password`). Restores access
        only (DEK wrapped by the server KEK, not the password), revokes all
        other sessions, is enumeration-free, and the email carries a link and
        nothing else. Known gap, recorded: sign-up email is not verified.
- [ ] **Hardening sweep** — the ledgered non-blocking findings
      (`.superpowers/sdd/progress.md` holds the authoritative list; the
      account-management phase appended its own non-blocking findings there).
      Substantive: resolve message paths over raw rows on the chat page,
      therapist reading view, and regenerate context so a corrupt
      ciphertext row can't sever readable ancestors (the `riskById`
      pattern shows how). The rest: unread tie-break at the marker
      timestamp, 429 "gentle pace" copy on hide/restore, degenerate
      chat-request fallback should throw, off-path `regenerateOf`
      widening (doc or check), crisis counter sync on focus/anchor
      landings, a11y focus-restore on confirm dismiss + `inert` on
      collapsed drawers, `data-*` e2e hooks, unit pin for the
      intervention `viewLeafId` resync, never-rerun comment on migration
      0014, MessageEdit/composer trim alignment, X-Robots-Tag belt,
      error-class `.name` overrides, e2e for direct-nav hidden chip.

## Bar 3 — v2 (explicitly deferred by the founding spec; not "completion")

Therapist themes dashboard · reminders/notifications (pg-boss) · native
apps · multi-therapist per client · billing/marketplace.

**Recommended order:** deploy first — real usage informs the sweep — then
run account-management as the next phase.
