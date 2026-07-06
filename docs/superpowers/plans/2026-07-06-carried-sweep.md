# tellmewhy Carried Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close the fast-follow ledger carried out of the titles cycle: failed sends must never be silent or lossy, the title watcher must survive its remaining kill-trigger, the docked crisis card must be heard by screen readers, and the server stops redundant key unwraps.

**Prerequisite:** executes directly on `main` (single-branch repo); base `9ef8376`; gates at base: 107 unit, e2e 10/10, tsc/lint/build green. Full gates before every commit. Design skills (`frontend-design`, `make-interfaces-feel-better`, `transitions-dev`) for anything visual.

## Global Constraints

Standing invariants: no message/title text in logs or console; crisis contract strings untouchable; encryption/ownership layers untouched; no new packages; raw DEKs must never be cached across requests (per-request memoization only).

---

### Task 1: Composer resilience — failed sends are visible and lossless

The head ledger item. Today: a 429 (or any send failure) makes the typing dots vanish silently; the message survives only in local state until reload. Worse on the hero handoff: the sessionStorage draft is deleted BEFORE `sendMessage`, so a failed auto-send permanently loses the user's first message.

- **Surface errors:** render `useChat`'s error state in `ChatScreen` as a gentle inline notice above the composer (`role="alert"`, twilight tones — warm, not alarming): a 429 shows the server's "Slow down a little" flavor ("Take a breath — a moment before the next message."); other failures a generic "That didn't send. Your words are safe below — try again." with a Retry affordance (re-send the failed text).
- **Lossless drafts:** on ANY send failure, the failed message text must be recoverable — restore it into the composer input (preferred) so the user can retry/edit. For the hero handoff specifically: only remove the `tellmewhy:draft:<id>` key after the send has succeeded (first assistant token or `onFinish` — pick the earliest reliable signal in ai v6 and document it); on failure, restore into the composer like any other failed send.
- **Tests:** route-level 429 already tested; add e2e or targeted coverage where deterministic (a unit test for any extracted pure helper; e2e only if it can be made non-flaky — the rate limiter needs 20 sends, so prefer driving the failure via a mocked fetch in a component-adjacent way, or document why e2e is impractical).
- **Commit:** `🚸 Keep failed messages visible, recoverable, and retryable`

### Task 2: Client hardening batch (one commit per item)

1. **Watcher survives fast follow-up sends:** the title watcher still dies if a second message is sent within its poll window (`messages.length`/`status` in deps re-run the effect; the started-guard blocks restart). Restructure so ARMING is the only effect-reactive step and the running poll's lifetime is owned by a ref-held controller cancelled ONLY on unmount — not on effect re-runs. Keep the single-refresh + cleanup guarantees. Commit `🐛`.
2. **Docked crisis card announces:** add a visually-hidden `role="status"`/`aria-live="assertive"` companion that announces the crisis resources when the docked (non-modal) card appears — screen-reader pairs inconsistently announce never-focused alertdialogs. Overlay variant unchanged (it takes focus). Contract strings untouched. Commit `♿️`.
3. **Surrogate-safe title clamp:** `rawTitle.trim().slice(0, 80)` can split an emoji; clamp by code points (`[...t].slice(0, 80).join("")`). Unit test with an emoji-boundary case. Commit `🩹`.
4. **Card-menu error banner `pointer-events-none`** (it currently intercepts clicks to the card link beneath). Commit `🩹`.
5. **Swap the two 50ms real-time negative-test windows** in the auto-title route tests for spy-based waits (the reviewer-noted deterministic alternative). Commit `✅`.

### Task 3: Server pair (one commit per item)

1. **Per-request DEK memoization:** the chat route unwraps the same user's DEK 4–5× per request (saveMessage ×2, loadMessages, isTitleCustomized, renameConversation). Memoize within a single request only — investigate React's `cache()` semantics in route handlers on the installed Next; if it doesn't dedupe there, use an explicit small request-scoped mechanism (e.g. AsyncLocalStorage-backed or plumbed-through context) — NEVER a module-level map keyed by user (cross-request plaintext key retention is a security regression). Prove the dedup with a test (spy on the key provider's unwrap). Commit `⚡️`.
2. **Hero create-side rate limit:** `POST /api/conversations` gets its own token bucket (separate limiter instance, 10 creates / 5 min per user — generous for real use, stops orphan-conversation spam), 429 with a gentle message; hero surfaces it via the existing inline error. Unit/route test. Commit `🦺`.

---

## Verification (whole sweep)

1. All gates green after every commit; final: unit suite (report count), e2e 10/10+ via `E2E_PORT=3101` isolated worktree, tsc, lint, build.
2. Manual: fail a send (dev-tools offline) → notice + text restored in composer; retry works. Fast double-send in a fresh conversation → title still lands live.
3. Human validation → review gate (mandatory tail).
