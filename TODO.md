# Road to "completed"

Three bars, in order. Status as of 2026-07-18 (phase 5 gate-closed, repo
public, deploy config shipped and reviewed — see `docs/DEPLOY.md`).

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
  - [ ] Be operationally ready to honor deletion-by-request.

## Bar 2 — v1 is honestly complete

- [ ] **Account-management phase** (spec → plan → build, the usual cycle):
  - [ ] Self-serve account deletion — `shredUserKey` crypto-shredding is
        implemented and tested; missing is the user-facing flow (confirm
        UI, session teardown, therapist-side unlinking, audit line). This
        is the one IOU the public copy admits.
  - [ ] Password recovery — email+password auth has no reset path and no
        email sending; a forgotten password is permanent lockout with no
        admin workaround (crypto-shredding). Ship reset via an email
        provider, or an explicit "there is no recovery" warning at
        sign-up. Decide which during the phase brainstorm.
- [ ] **Hardening sweep** — the ledgered non-blocking findings
      (`.superpowers/sdd/progress.md` holds the authoritative list).
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
