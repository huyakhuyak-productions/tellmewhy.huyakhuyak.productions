# tellmewhy — Self-hosted Umami Analytics

**Date:** 2026-07-19
**Status:** Approved (user-gated in session)

## What this is

Page-view analytics via the operator's own Umami instance
(self-hosted, cookieless), enabled app-wide — landing and authenticated
surfaces — configured entirely through Dokku env vars.

## Decisions

- **Scope: whole app** (user decision). Authenticated paths carry opaque UUIDs
  only; the instance is operator-run; Umami is cookieless. Paired with a
  disclosure line so the honesty standard holds.
- **Config via runtime env, no `NEXT_PUBLIC_`:** `UMAMI_SCRIPT_URL` +
  `UMAMI_WEBSITE_ID`, read server-side by `getUmamiConfig()` in
  `src/lib/umami.ts` — returns `null` unless BOTH are set, so dev/test/CI
  render nothing (the email-mock posture).
- **Rendering:** root layout (server component) renders `next/script` with
  `strategy="afterInteractive"`, `src`, `data-website-id` when configured.
  Umami's script self-tracks SPA route changes; one load covers the session.
- **Dokku build/runtime split:** statically-prerendered pages
  (`/forgot-password`, `/goodbye`, `/_not-found`) bake env at image-build
  time, when `dokku config` isn't in scope. Fix: `ARG UMAMI_SCRIPT_URL` /
  `ARG UMAMI_WEBSITE_ID` + matching `ENV` in the Dockerfile build stage —
  Dokku passes config vars as build args for declared ARGs, so static pages
  bake correctly.
- **Disclosure (one sentence, three surfaces):** landing privacy section,
  README privacy model, `public/llms.txt` — we run our own cookieless
  analytics (Umami) on our own server: page views and paths only, no cookies,
  no third party, never message content.
- **Out of scope (YAGNI):** custom events, `data-domains`, CSP, consent
  banner (cookieless — nothing to consent-gate).

## Testing

Unit: `getUmamiConfig` — both vars set → `{src, websiteId}`; either missing →
`null`. Manual post-deploy: script tag in prod HTML, a pageview lands in the
Umami dashboard. `docs/DEPLOY.md` documents both vars.
