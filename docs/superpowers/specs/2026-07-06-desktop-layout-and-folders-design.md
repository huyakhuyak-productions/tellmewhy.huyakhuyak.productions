# tellmewhy — Desktop Layout & Conversation Folders

**Date:** 2026-07-06
**Status:** Approved design (mockup variant 09 "Composite", user-final)
**Depends on:** Foundation sub-project (`feature/foundation`), merged first

## What this is

The shipped v1 is mobile-first and reads as mobile-only on desktop. This sub-project gives desktop users a real experience — chosen by the user from 9 mockup variants as a composite — and adds **conversation folders**, a product feature that applies to all viewports.

The definitive mockup is variant 09 in the throwaway exploration page (session scratchpad, `desktop-design-options.html`). This spec captures everything needed to rebuild it in the real codebase; the mockup is reference, not source.

## Design decisions (user-final)

### Home screen (`/chat`) — "Guided hero + Garden cards"

- A large, centered serif invitation with the composer as the hero: **underline-only input** — no box, no background, no rounded container; a 1.5px baseline rule under generous (~19px) serif italic type, a quiet send arrow at the rule's end. On focus the rule warms to the accent and thickens by a hairline — no glow, no layout shift.
- Submitting the hero creates a conversation and sends that text as its first message, landing on the conversation screen with the reply streaming. The new conversation's title stays date-based (current behavior); smarter titles are out of scope.
- Beneath: a few "pick up where you left off" cards (title, quiet folder tag, relative time). A centered folder filter-chip row (All · <user folders>) sits between hero and cards.
- Mobile keeps this same home in a single-column arrangement (hero above cards); the current conversation-list page is replaced by this home on all viewports.

### Conversation screen (`/chat/[id]`) — "Desk frame, Journal priority"

Desktop (≥ `lg`) is a three-zone frame; the center column is the star:

- **Left rail — conversations grouped by folder.** Small-caps chevroned folder headings (collapsible), conversations beneath; an "unsorted" group for folderless chats; a whisper-quiet "+ New folder" affordance at the rail foot. No fills or shadows — the rail structurally recedes (muted type, faded borders).
- **Center — the conversation, reading-optimized.** ~760px measure, generous line-height. **Passage/bubble rule (deterministic):** a message renders as a bubble when short, and as a long-form block when it has ≥ 2 paragraphs or > 280 characters. Long AI messages render as serif *passages* (left rule + small sender label, no bubble chrome); long user messages render as a gently tinted panel using body-colored text (must hold AA contrast in both themes). Short exchanges stay bubbles.
- **Right rail — quiet stats zone.** Real lightweight stats now (conversations this week, total conversations, member-since); tasteful placeholders for phase-2/3 (therapist review status, mood trend, notes). Same receded character as the left rail.
- **Crisis banner on desktop:** a width-capped card docked over the center column (not a floating phone toast). Mobile keeps the existing treatment.
- Mobile (< `lg`) keeps the current single-column chat exactly as shipped; rails don't exist there (folder navigation lives on the home screen).

### Visual language

The existing "twilight journal" token system (globals.css) is unchanged. Implementation notes from the mockup pass: rail-receding used `color-mix` — provide a static fallback for browsers below Chrome 111/Safari 16.2; all UI work goes through the frontend design skills (standing directive).

## Conversation folders (product feature, all viewports)

- Users organize conversations into folders. Starter suggestions offered at first use: "family", "work / career", "relationships", "friends" — all folders are user-defined and renamable/deletable.
- **Privacy constraint (hard):** folder names are topic metadata ("relationships", "health") and MUST be encrypted with the user's DEK exactly like conversation titles. No plaintext folder names in Postgres.
- Data model: `folders` table (`id` uuid, `user_id`, `name_ciphertext`, `created_at`) + nullable `folder_id` FK on `conversations` (null = unsorted). Deleting a folder unsorts its conversations (never deletes them).
- Repository layer owns encryption + ownership enforcement (same pattern and invariants as `conversations.ts`); routes stay thin. API: CRUD for folders, assign/unassign on conversations, folder filter on the conversations list.
- Phase-2 note: sharing grants remain per-conversation. Per-folder grant convenience may come later; the adversarial invariant stays conversation-scoped.

## Amendment (2026-07-06, user-requested): conversation titles

- **Auto-generated titles:** after the FIRST AI reply in a conversation, a cheap model call (classifier tier, same no-logging OpenRouter constraint) summarizes the opening exchange into a 3–6 word title, stored encrypted like any title. Runs fire-and-forget in the chat route's `onFinish` (no queue infra yet); failures logged (conversationId only), never surfaced mid-chat. Auto-titling only fires when the title is still the default — it never overwrites a human choice (enforced atomically in the UPDATE itself, not just a pre-check).
- **Crisis exception (product decision, 2026-07-06):** a crisis-flagged first message is never auto-titled — the conversation keeps its neutral date title. Encryption at rest covers database exposure, not display exposure: a generated title echoing crisis phrasing would sit prominently on the home screen for anyone glancing at it. The model-exposure argument ("it already saw the messages to reply") does not extend to what we choose to display.
- **Manual rename:** from the conversation rail's per-conversation menu (desktop) and a new overflow menu on the home cards (all viewports — which also brings folder-move to mobile, previously rail/desktop-only). Backed by extending `PATCH /api/conversations/[id]` with an optional `title`. Manual rename wins permanently (a `title_customized` flag suppresses future auto-titling).

## Out of scope

Mood tracking, therapist data, digests (their rail slots are placeholders); folder-level sharing; drag-and-drop assignment (a simple picker/menu suffices for v1); any change to the encryption model, chat transport, or crisis logic.

## Testing

- Unit/integration: folders repository (encrypted names proven at the DB-row level, ownership enforced adversarially, delete-unsorts behavior); conversations list grouped/filtered by folder; passage/bubble rule as a pure function with boundary cases (exactly 280 chars, exactly 2 paragraphs).
- e2e: existing mobile specs stay green unchanged; new desktop-viewport spec — home hero creates + sends and lands streaming; folder create/assign reflected in rail grouping and home filter chips.
- Manual: both themes at 1440px and 390px; AA contrast check on the tinted user panel.
