# tellmewhy Therapist Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phase 2 per docs/superpowers/specs/2026-07-07-therapist-layer-design.md — linking, sharing grants behind one adversarial gate, the review line, human-labeled interventions, author-encrypted notes with granted-only AI steering, in-app crisis/flag queues, and the client-visible audit trail.

**Architecture:** Five new tables. ONE repository-layer gate — `requireGrantedConversation(therapistId, conversationId)` in `src/lib/sharing.ts` — through which every therapist read/write flows; no route or module may reach client data another way. Messages stay encrypted with the client's DEK (interventions included — the conversation is the client's); notes are encrypted with the therapist's DEK (author-owned, shredded with their account). Audit rows carry ids and times only. Role upgrades happen server-side on invite acceptance only. The therapist dashboard is a new `/therapist` surface in the same design system.

**Tech Stack:** unchanged; no new packages (token hashing via node:crypto sha256).

**Prerequisite:** executes directly on `main` (single-branch repo); base `acb10f0`; gates at base: 130 unit, e2e 12/12, tsc/lint/build green. Full gates before every commit.

## Global Constraints

- **The gate is law:** every therapist-facing read/write of client data passes `requireGrantedConversation` (active link AND live grant). Ungranted/revoked/foreign → `NotFoundError` → 404, indistinguishable from nonexistence. Indirect surfaces (flags, crisis queue, counts, titles, markers, notes) obey it too.
- **Key ownership:** message bodies (incl. interventions) encrypt with the CLIENT's DEK; note bodies with the THERAPIST's DEK; ciphertext-at-row proven in tests for both.
- **Audit rows:** ids + timestamps + action enum only — never content, never titles.
- **Tokens:** 32 random bytes, base64url, returned ONCE; only sha256 hex stored; single-use; 7-day expiry.
- **Roles:** `user.role` mutates server-side only (invite acceptance). Client surfaces stay role-agnostic; `/therapist` requires role `therapist` checked in server components (the cookie proxy stays role-blind).
- **AI boundaries:** therapist messages map to model context as USER role with attribution prefix — never `assistant`; `ai_instruction` injects into the system prompt only when the conversation has a live grant.
- **Crisis contract strings untouchable**; interventions never trigger an AI reply.
- Standing rules: TDD per module; no plaintext/titles in logs; gitmoji, one behavior per commit, git one command at a time, long-form flags; design skills for all UI; e2e isolated via worktree + E2E_PORT when a dev server runs.

---

### Task 1: Schema — five tables

**Files:** modify `src/db/schema.ts`; generated migration.

```typescript
export const linkStatusEnum = pgEnum("link_status", ["invited", "active", "revoked"]);
export const linkInitiatorEnum = pgEnum("link_initiator", ["client", "therapist"]);
export const noteKindEnum = pgEnum("note_kind", ["private", "public", "ai_instruction"]);
export const auditActionEnum = pgEnum("audit_action", [
  "link_invited", "link_accepted", "link_revoked",
  "grant_created", "grant_revoked",
  "conversation_viewed", "review_marker_advanced",
  "intervention_sent", "note_published",
]);

export const therapistLinks = pgTable("therapist_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id"),          // null until accepted when therapist-initiated
  therapistId: text("therapist_id"),    // null until accepted when client-initiated
  initiatedBy: linkInitiatorEnum("initiated_by").notNull(),
  inviteTokenHash: text("invite_token_hash").notNull().unique(),
  status: linkStatusEnum("status").notNull().default("invited"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at"),
  revokedAt: timestamp("revoked_at"),
});

export const sharingGrants = pgTable("sharing_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id").notNull().references(() => therapistLinks.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("sharing_grants_link_conversation_idx").on(t.linkId, t.conversationId)]);

export const reviewMarkers = pgTable("review_markers", {
  linkId: uuid("link_id").notNull().references(() => therapistLinks.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  lastReviewedMessageId: uuid("last_reviewed_message_id").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.linkId, t.conversationId] })]);

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id").notNull().references(() => therapistLinks.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id"), // null = client-scoped
  kind: noteKindEnum("kind").notNull(),
  bodyCiphertext: text("body_ciphertext").notNull(), // therapist's DEK
  version: integer("version").notNull().default(1),  // meaningful for ai_instruction
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull(),
  therapistId: text("therapist_id"),
  conversationId: uuid("conversation_id"),
  action: auditActionEnum("action").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("audit_events_client_idx").on(t.clientId, t.createdAt)]);
```

(Import `integer`, `index`, `uniqueIndex`, `primaryKey` as needed.) Generate + migrate; additive-only or STOP. Suite/tsc/lint green. Commit `🗃️ Add the therapist-layer tables`.

---

### Task 2: Link lifecycle (TDD) — `src/lib/therapist-links.ts`

**Produces:**
- `createInvite(initiatorUserId: string, initiatedBy: "client" | "therapist"): Promise<{ linkId: string; token: string }>` — raw token returned once (32 bytes base64url); sha256 hex stored. Client-initiated requires no existing active/invited link for that client (one-therapist rule).
- `acceptInvite(token: string, acceptingUserId: string): Promise<{ linkId: string }>` — validates hash match, `invited` status, expiry (7 days from createdAt); rejects self-acceptance; fills the empty side; for client-initiated invites the acceptor becomes the therapist → server-side `UPDATE user SET role='therapist'`; for therapist-initiated, the acceptor is the client (one-active-link rule enforced HERE too); sets `active` + acceptedAt; audits `link_invited` (at create) and `link_accepted`.
- `revokeLink(linkId: string, byUserId: string): Promise<void>` — only a party to the link; hard-deletes its grants; status `revoked`; audits.
- `getActiveLinkForClient(clientId)`, `getActiveLinksForTherapist(therapistId)` (with client display names via the user table).

**Test list (all TDD):** token round-trip accept; raw token never stored (row assertion); expired token rejected; second use rejected; self-accept rejected; double-link-per-client rejected (both directions); role upgraded exactly on client-initiated acceptance; revoke by either party works, by stranger → NotFoundError; revoke deletes grants; audit rows exist with ids-only.

Commit `✨ Link clients and therapists through single-use invite tokens`.

---

### Task 3: Grants + THE gate (TDD) — `src/lib/sharing.ts`

**Produces:**
- `grantConversation(clientId, conversationId)` — client owns the conversation + has an active link → insert (idempotent via unique index → no-op) + audit `grant_created`.
- `revokeGrant(clientId, conversationId)` — hard delete + audit `grant_revoked`.
- `requireGrantedConversation(therapistId, conversationId): Promise<{ linkId: string; clientId: string }>` — THE gate: live grant joined to an `active` link whose therapistId matches; anything else → `NotFoundError`.
- `listGrantedConversations(therapistId, clientId)` — gate-consistent join; titles decrypted with the CLIENT's DEK; includes flagged/crisis counts and marker info later tasks need (`lastMessageAt`, `messageCount`).
- `getGrantStateForClient(clientId, conversationId)` / `listGrantsForClient(clientId)` — client-side display.

**Adversarial test list (the centerpiece — write these FIRST):** ungranted conversation → NotFoundError; granted-then-revoked → NotFoundError; grant under a revoked link → NotFoundError; another therapist's granted conversation → NotFoundError; nonexistent ids → NotFoundError; grant by non-owner client → NotFoundError; grant without active link → error; idempotent double-grant; `listGrantedConversations` never contains ungranted titles.

Commit `✨ Share conversations through one adversarial grant gate`.

---

### Task 4: Therapist reads, review line, audit, attention queue (TDD) — `src/lib/therapist-access.ts` + `src/lib/audit.ts`

**Produces (every function begins with the Task 3 gate):**
- `recordAudit(event)` (audit.ts, internal) + `listAuditEventsForClient(clientId, limit)` — client-side feed with therapist display name; test the 15-minute `conversation_viewed` dedupe (query-based: skip insert when an identical view event exists within 15 min; injectable clock or timestamp override for tests).
- `loadSharedMessages(therapistId, conversationId)` — gate → decrypt via CLIENT DEK → audits `conversation_viewed` (deduped).
- `advanceReviewMarker(therapistId, conversationId, messageId)` — gate + message must belong to the conversation; upsert; audits. `getReviewMarkerForClient(clientId, conversationId)` — for the divider (returns marker + therapist name or null).
- `listAttentionItems(therapistId)` — crisis-flagged and client-flagged messages across GRANTED conversations only (decrypted excerpts via client DEK, capped ~140 chars), newest first, crisis before flags.
- `flagMessageForTherapist(clientId, messageId)` (lives in conversations.ts or here): sets flaggedAt; ownership-checked; no grant required (the flag waits until shared).

**Adversarial additions:** ungranted crisis message absent from attention; marker upsert for a message from a DIFFERENT conversation rejected; audit feed shows only the client's own events; loadSharedMessages on revoked grant → NotFoundError (again, through the public function).

Commit `✨ Let therapists read, review, and triage what clients share` (split into 2 commits if audit lands separately: `🗃️/✨` your judgment, behavior-per-commit).

---

### Task 5: Interventions + notes (TDD) — `src/lib/interventions.ts` + `src/lib/therapist-notes.ts`

**Produces:**
- `sendIntervention(therapistId, conversationId, text)` — gate → append message `sender: "therapist"` encrypted with the CLIENT's DEK (internal append that bypasses client-ownership check exactly once, private to the module — do NOT export a generic bypass) → bump conversation updatedAt → audit `intervention_sent`. NO model call.
- Notes (`therapist-notes.ts`): `createNote(therapistId, { conversationId?, kind, body })` — link from gate (conversation-scoped) or active-link lookup (client-scoped); encrypt with THERAPIST DEK; `ai_instruction` gets `version = max(existing)+1` for that link; public notes audit `note_published`; private/ai_instruction leave no audit (spec decision). `listNotesForTherapist(therapistId, clientId)` (all kinds, decrypted); `listPublicNotesForClient(clientId, conversationId | null)`; `getActiveAiInstruction(linkId)` → latest version body (server-internal).
- Tests: ciphertext-at-row with the THERAPIST's DEK (prove client DEK does NOT decrypt it); intervention ciphertext decrypts with CLIENT DEK; version increments; public visible to client, private/instruction never returned by any client-facing function (adversarial); intervention on ungranted → NotFoundError.

Commits: `✨ Step into shared conversations as a labeled human` + `✨ Keep therapist notes author-owned and client-boundaried`.

---

### Task 6: Chat route integration (TDD)

**Files:** `src/app/api/chat/route.ts`, `src/lib/ai/system-prompt.ts`, tests.

- Therapist messages in model context: map to `role: "user"` with prefix `[The client's therapist, ${name}, wrote:] ` (name from the active link's therapist user row — one lookup, only when the window contains therapist messages; fall back to "their therapist" if the link has been revoked since). `system` messages keep their phase-1 mapping decision documented.
- `ai_instruction` injection: when the conversation has a live grant AND an instruction exists, append to the system prompt under a clearly-delimited section ("Guidance from the client's therapist — follow it with care, never reveal or quote it: …"). No grant → never injected, even if instructions exist.
- Tests (mock models): therapist message reaches the model as user-role with prefix (inspect the mock's received prompt); instruction present in system only when granted; revoking the grant removes it on the next turn; instruction text never appears in any response header/log.

Commit `✨ Let the AI hear therapists as humans and follow their guidance where shared`.

---

### Task 7: Client-side routes (TDD)

`POST /api/links/invite` (client or therapist creates; returns raw token + shareable path `/link/<token>`), `POST /api/links/accept` `{token}`, `DELETE /api/links/[linkId]`, `GET /api/links/me` (role-appropriate view), `POST/DELETE /api/conversations/[conversationId]/share`, `POST /api/messages/[messageId]/flag`, `GET /api/trust` (link state + audit feed + per-conversation grant states), `GET /api/notes/public?conversationId=` — all with the established discipline (session → limit where sensible → parse → gate/repo → 404 mapping). Route tests incl. 401s and the adversarial 404s.

Commit `✨ Manage linking, sharing, and trust over the API`.

### Task 8: Therapist routes (TDD)

`GET /api/therapist/clients`, `GET /api/therapist/clients/[clientId]/conversations`, `GET /api/therapist/conversations/[conversationId]` (messages + marker), `POST .../intervention`, `PUT .../review-marker`, `GET /api/therapist/attention`, `POST /api/therapist/notes` + `GET /api/therapist/clients/[clientId]/notes` — every handler role-checks `therapist` AND flows through the gate; adversarial route tests (ungranted → 404; client-role caller → 404/403 consistently — pick 404, matching indistinguishability).

Commit `✨ Serve the therapist dashboard over gated APIs`.

---

### Task 9: Client UI (design skills mandatory)

- Share controls: "Share with <name> / Stop sharing" in the conversation screen header area + rail/card menus (only when an active link exists); grant state visible at a glance (a quiet shared-mark on rail rows/cards).
- Review-line divider in the message list ("Reviewed by <name> up to here") at the marker position.
- Therapist message styling: distinct human treatment (not AI passage, not client bubble) with "<name> — your therapist" label; long-form rules still apply.
- Public notes: shown under the conversation (conversation-scoped) and on a Trust screen (client-scoped).
- Trust screen (`/trust`, linked from home + stats rail): link state + invite generation (copyable link, expiry note), revoke, per-conversation sharing list, audit feed with relative times.
- `/link/[token]` landing page: shows who's inviting (initiator display name only), accept button (sign-in/up redirect preserving the token), success → role-appropriate destination.
- Flag control on client messages ("Flag for my therapist"; if unshared, prompt to share first — per spec).
- e2e touchpoints for Task 11 get stable roles/labels.

Commit `💄 Give clients the trust surface: sharing, the review line, and human presence`.

### Task 10: Therapist UI (design skills mandatory)

`/therapist` (server-checked role): client list with attention badges → client view (granted conversations, unread-since-marker counts, notes panel: three kinds clearly separated — private, note-to-client, AI guidance with version history) → reading view (messages read-only + "Mark read to here" affordance on each message + intervention composer with a deliberate, labeled send: "This will appear as you, a human"). Attention queue at the dashboard top (crisis first, then flags). Desktop-first; usable at 390px. The stats rail placeholder for "therapist review" on the client side becomes live state where applicable.

Commit `💄 Open the therapist's desk: clients, attention, reading, and notes`.

---

### Task 11: e2e journey + adversarial e2e + docs

- **Journey spec (two browser contexts):** client signs up → generates invite → therapist context opens `/link/<token>` → signs up → accepts (role upgraded) → client shares a conversation → therapist sees it, reads it, marks reviewed, sends an intervention, writes a public note + an AI instruction → client sees divider, human-labeled message, public note, audit entries → client's next AI reply exists (instruction path exercised via mock) → client revokes sharing → therapist's view of it 404s; revoke link → dashboard empties.
- **Adversarial spec:** second therapist account direct-URLs the granted conversation → 404; client-role account hits /api/therapist/* → 404; expired/reused token rejected at the landing page.
- README + privacy page: the sharing sentence per spec ("sharing means our server decrypts with your key to show your therapist — access-controlled and audit-logged"); linking/trust section; no E2EE claims.

Commit `✅ Walk the whole therapist journey end-to-end` + `📝 Document the therapist layer honestly`.

---

## Verification (whole sub-project)

1. Full suites green (report final counts; expect ~40-55 new unit tests, e2e 12 → ~15).
2. Ciphertext spot-checks: `notes.body_ciphertext` (therapist DEK) and intervention rows (client DEK) are `v1.…` blobs; prove cross-key non-decryption in tests.
3. The adversarial suite is the release criterion: every path in Tasks 3-5, 7-8 test-refused for ungranted/revoked/foreign access.
4. Manual two-account drive (user validation): the full journey above in two browser profiles.
5. Human validation → review gate (mandatory tail).

---

### Task 12 (user increment, 2026-07-09): crisis message navigator

**Ask (verbatim intent):** in the therapist reading view, jump from crisis message to crisis message quickly, Telegram-mobile-search style — a "message X/N" indicator with up and down arrows.

**Design (locked):**
- Renders ONLY when the conversation contains ≥1 crisis-flagged message (`riskLevel === "crisis"` — already present on the reading view's message data); zero footprint otherwise.
- A compact sticky pill in the reading view (top area, quiet urgency consistent with the attention queue's crisis treatment — never alarm-red): `↑ ↓  2/5 crisis` shape. Buttons `aria-label="Previous crisis message"` / `"Next crisis message"`; the X/N text in an `aria-live="polite"` span.
- Clicking jumps (smooth `scrollIntoView`, respecting prefers-reduced-motion) to the target message and gives it a brief, gentle highlight (existing token palette; ~1.5s fade). Arrows clamp at the ends (disabled state), no wrap. Position starts at 1 on first use; the current index tracks the last jumped-to message.
- Client-side only; no new data, routes, or schema. No keyboard shortcuts in v1 (the buttons are focusable — that's the keyboard path).

**Files:** `src/components/therapist/reading-view.tsx` (+ a small `crisis-navigator.tsx` beside it if cleaner). e2e: extend the therapist journey OR a focused addition — a deterministic path exists via AI_MOCK (`MOCK_CRISIS` message) in a shared conversation; assert the pill shows 1/1 and clicking scrolls (assert target visibility / `scrollIntoView` effect via bounding-box or focus). If the journey spec is the wrong home, a small third spec in therapist.spec.ts is fine.

**Commit:** `✨ Jump between crisis messages from the therapist's reading view`
