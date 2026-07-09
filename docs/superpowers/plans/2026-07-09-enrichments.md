# tellmewhy Enrichments (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phase 3 per docs/superpowers/specs/2026-07-09-enrichments-design.md — on-demand cached AI session digests behind THE gate, one-tap mood check-ins with an opt-in scores-only therapist trendline, and homework/exercises founded on the CBT thought record, completable via a worksheet form or an AI-guided chat walk-through.

**Architecture:** Four new tables, all content under the CLIENT's DEK. Digests generate lazily inside the therapist's gated read path and cache latest-only. Mood sharing is a nullable timestamp on the existing link row (revocation kills it structurally). Exercises assign at link level; entries are private until per-entry `sharedAt`. The chat system prompt gains mood + homework sections; the crisis addendum stays LAST, always.

**Tech Stack:** unchanged; **no new packages** (on-demand digests need no queue).

**Prerequisite:** executes directly on `main` (single-branch repo); base `d4edcef`; gates at base: 381 unit, e2e 15/15, tsc/lint/build green. Full gates before every commit. NOTE: `docs/HANDOFF.md` sits staged-but-uncommitted in the index by user decision — never commit it; use pathspec-scoped commits (`git commit --message "…" -- <files>`).

## Global Constraints

- **The gate is law:** digests (generation AND reads) flow through `requireGrantedConversation`. Ungranted/revoked/foreign → `NotFoundError` → 404, indistinguishable from nonexistence — including a digest that already existed before revocation.
- **Key ownership:** mood payloads, digest bodies, exercise instructions, and entry payloads ALL encrypt with the CLIENT's DEK (`encryptText`/`decryptText` + `getOrCreateUserDek`); ciphertext-at-row + cross-key non-decryption proven in tests for each new table.
- **Plaintext columns are ids + times + enums only** — same discipline as audit. Mood trend shared with a therapist = scores + dates ONLY; note contents never leave client-facing functions.
- **Consent:** mood trendline requires the Trust-screen toggle (default OFF) AND an active link. Entry content requires that entry's `sharedAt` AND a live link through its exercise. Engagement (counts + dates) needs only the active link.
- **AI boundaries:** every LLM call uses the existing model-factory pattern (`AI_MOCK` mock + `NO_LOGGING` OpenRouter settings + prod guard) and an explicit `maxOutputTokens` cap. System-prompt order: base → mood line → homework section → therapist guidance → **crisis addendum LAST**.
- **Crisis contract strings untouchable.** Crisis-related digest content renders warm amber, never red. The AI-guided walk-through is still a chat: the crisis classifier runs on every client message unchanged.
- Standing rules: TDD per module; no plaintext/titles/scores in logs; gitmoji, one behavior per commit, git one command at a time, long-form flags; design skills (`frontend-design`, `make-interfaces-feel-better`, `transitions-dev`) for all UI; e2e isolated via worktree + `E2E_PORT` when a dev server runs.

---

### Task 1: Schema — four tables + link column + audit actions

**Files:** modify `src/db/schema.ts`; generated migration.

```typescript
import { date } from "drizzle-orm/pg-core"; // add to existing import

export const exerciseTypeEnum = pgEnum("exercise_type", ["thought_record"]);
export const exerciseStatusEnum = pgEnum("exercise_status", ["active", "closed"]);
// auditActionEnum gains: "exercise_assigned", "entry_shared", "entry_viewed", "mood_trend_viewed"

// One check-in per user per day; payload = {score: 1-5, note?} under the
// client's DEK. A repeat check-in on the same day updates the row.
export const moodCheckins = pgTable("mood_checkins", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  day: date("day").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("mood_checkins_user_day_idx").on(t.userId, t.day)]);

// Latest-only digest per conversation; body (summary + anchors JSON) under
// the CLIENT's DEK. covers_up_to_message_id/generated_at stay plaintext —
// ids + times only, the audit discipline.
export const digests = pgTable("digests", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().unique()
    .references(() => conversations.id, { onDelete: "cascade" }),
  bodyCiphertext: text("body_ciphertext").notNull(),
  coversUpToMessageId: uuid("covers_up_to_message_id").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

// Therapist-assigned exercise; instruction is therapist-authored but
// client-visible → CLIENT's DEK (the interventions law).
export const exercises = pgTable("exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id").notNull().references(() => therapistLinks.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  type: exerciseTypeEnum("type").notNull(),
  instructionCiphertext: text("instruction_ciphertext").notNull(),
  status: exerciseStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("exercises_client_id_idx").on(t.clientId)]);

// A completed thought record. exercise_id null = self-guided. shared_at null
// = private forever unless the client shares this one entry.
export const exerciseEntries = pgTable("exercise_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  exerciseId: uuid("exercise_id").references(() => exercises.id, { onDelete: "set null" }),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  sharedAt: timestamp("shared_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("exercise_entries_user_id_idx").on(t.userId),
  index("exercise_entries_exercise_id_idx").on(t.exerciseId),
]);

// therapistLinks gains one column (mood sharing rides the link so revocation
// kills it structurally):
//   moodSharedAt: timestamp("mood_shared_at"),
```

Generate + migrate; additive-only or STOP. Suite/tsc/lint green. Commit `🗃️ Add the enrichment tables: mood, digests, exercises`.

---

### Task 2: Mood domain (TDD) — `src/lib/mood.ts`

**Consumes:** `encryptText`/`decryptText` (`crypto/envelope`), `getOrCreateUserDek` (`crypto/user-keys`), `getActiveLinkForClient`/`getActiveLinksForTherapist` (`therapist-links`), `recordAuditDeduped` (`audit`), `NotFoundError` (`errors`).

**Produces:**
- `export type MoodCheckin = { day: string; score: number; note: string | null }` (`day` = `YYYY-MM-DD`).
- `checkInMood(userId: string, input: { score: number; note?: string }, day?: string): Promise<void>` — score integer 1–5 or throw; note ≤ 500 chars; `day` defaults to today (server date, `YYYY-MM-DD`); payload `JSON.stringify({score, note})` encrypted with the client's DEK; upsert on `(userId, day)` (`onConflictDoUpdate` — set payload + updatedAt).
- `listMoodCheckins(userId: string, sinceDays: number): Promise<MoodCheckin[]>` — decrypted, ascending by day, corrupt-row isolation (`flatMap` + try/catch like `listConversations`).
- `setMoodSharing(clientId: string, enabled: boolean): Promise<void>` — requires an active link (`NotFoundError` otherwise); sets/clears `moodSharedAt` on that link row.
- `getMoodSharingState(clientId: string): Promise<boolean>` — active link with `moodSharedAt` set.
- `getMoodTrendForTherapist(therapistId: string, clientId: string): Promise<{ day: string; score: number }[]>` — active link for this exact (therapist, client) pair AND `moodSharedAt` set, else `NotFoundError`; **scores + days ONLY — the note field never crosses this function**, last 56 days; audits `mood_trend_viewed` deduped 15 min (reuse `recordAuditDeduped`).
- `buildMoodContextLine(checkins: MoodCheckin[]): string | null` — pure; null when empty; otherwise one compact line, e.g. `Recent mood check-ins (1 low – 5 good): 2026-07-07: 2, 2026-07-08: 3. Notes: "…"` — client's own notes MAY appear here (this line goes into the client's own chat prompt, nowhere else); clamp each note to 100 chars, whole line ≤ 600 chars.

**Test list (TDD):** ciphertext-at-row (`v1.` prefix, plaintext absent); cross-key non-decryption (another user's DEK throws); same-day upsert replaces score; score 0/6/non-integer rejected; note > 500 rejected; trend without toggle → NotFoundError; trend with toggle but revoked link → NotFoundError; foreign therapist → NotFoundError; trend never contains notes (assert shape has no `note` key); toggle without active link → NotFoundError; `mood_trend_viewed` audit row exists, ids-only, deduped; context line null/format/clamps.

Commit `✨ Check in a daily mood and share the trend on the client's terms`.

---

### Task 3: Digest domain (TDD) — `src/lib/digests.ts` + model factory

**Files:** create `src/lib/digests.ts`; modify `src/lib/ai/models.ts` (add `getDigestModel`), `src/lib/ai/system-prompt.ts` (add `buildDigestPrompt`).

**Consumes:** `requireGrantedConversation` (`sharing`), crypto helpers, `db` + `digests`/`messages` tables, `generateObject` from `ai`, `z` from `zod`.

**Produces:**
- `models.ts`: `getDigestModel(): LanguageModel` — mock (deterministic JSON below) / `openrouter()(process.env.OPENROUTER_DIGEST_MODEL ?? "anthropic/claude-sonnet-4.5", NO_LOGGING)`. Mock `doGenerate` returns `JSON.stringify({ overview: "A mock digest overview.", themes: ["mock theme"], anchors: [] })`.
- `system-prompt.ts`: `buildDigestPrompt(input: { priorDigest: string | null; transcript: string }): string` — instructs: summarize for the client's own therapist; calm, non-diagnostic language; return themes, a short overview, and anchors referencing ONLY the provided `[message <uuid>]` markers; flag risk signals plainly.
- `digests.ts`:
  - `export type DigestBody = { overview: string; themes: string[]; anchors: { messageId: string; label: string; kind: "moment" | "risk" }[] }` (zod-parsed).
  - `export type DigestForTherapist = DigestBody & { coversUpToMessageId: string; generatedAt: Date; stale: boolean }`.
  - `getOrRefreshDigest(therapistId: string, conversationId: string): Promise<DigestForTherapist | null>` — **gate FIRST** (`requireGrantedConversation` → clientId); load newest message id; if a digest row exists and covers it → return it decrypted, `stale: false`. Otherwise generate: decrypt messages after `coversUpToMessageId` (or all, first time), build transcript lines `[message <id>] <sender>: <text>` (clamp each message to 500 chars, window to the most recent 200 messages), include prior digest body when incremental; `generateObject({ model: getDigestModel(), schema, prompt, maxOutputTokens: 1024, abortSignal: AbortSignal.timeout(20_000) })`; **filter anchors to messageIds that actually belong to this conversation** (hallucination guard); encrypt with the CLIENT's DEK; upsert on `conversationId` (latest-only); return fresh. On generation failure: return the prior digest decrypted with `stale: true`, or `null` when none exists — never throw past the gate, log id-only.
  - No standalone read function — get-or-refresh IS the read path (spec: on-demand).

**Adversarial test list (write FIRST):** ungranted → NotFoundError (no digest row created — assert table empty); granted-then-revoked with an EXISTING digest row → NotFoundError (the row's existence leaks nothing); foreign therapist → NotFoundError; anchors with fabricated messageIds are dropped; body ciphertext-at-row under the CLIENT's DEK + cross-key non-decryption; staleness: new message → regenerates (mock call count), no new message → cached (no model call); generation failure with prior digest → stale body returned; failure with none → null; transcript clamps respected.

Commit `✨ Digest shared conversations on demand behind the gate`.

---

### Task 4: Exercises domain (TDD) — `src/lib/exercises.ts`

**Consumes:** crypto helpers, `getActiveLinksForTherapist`/`getActiveLinkForClient` (`therapist-links`), `recordAudit`/`recordAuditDeduped` (`audit`), `NotFoundError`, `z`.

**Produces:**
- `export const thoughtRecordSchema = z.object({ situation: z.string().min(1).max(2000), thoughts: z.string().min(1).max(2000), emotions: z.string().min(1).max(2000), behavior: z.string().min(1).max(2000), bodySensations: z.string().max(2000).optional(), occurredAt: z.string().max(100).optional() })`; `export type ThoughtRecordPayload = z.infer<typeof thoughtRecordSchema>`.
- `assignExercise(therapistId: string, clientId: string, input: { type: "thought_record"; instruction: string }): Promise<{ id: string }>` — active link for this exact pair or `NotFoundError`; instruction 1–2000 chars; encrypt with the **CLIENT's** DEK; audit `exercise_assigned` (ids-only, actor = therapist).
- `closeExercise(therapistId: string, exerciseId: string): Promise<void>` — only the assigning link's therapist, link still active; sets `status: "closed"`; entries untouched.
- `listExercisesForClient(userId: string): Promise<{ id: string; type: "thought_record"; instruction: string; status: "active" | "closed"; therapistName: string | null; createdAt: Date }[]>` — decrypted; therapist name via link join (null if link revoked — assignment stays visible: client data).
- `saveEntry(userId: string, input: { exerciseId?: string; payload: ThoughtRecordPayload }): Promise<{ id: string }>` — zod-parse; when `exerciseId` given it must belong to this user (`clientId` match) or `NotFoundError`; encrypt payload with the client's DEK; `sharedAt` starts null.
- `shareEntry(userId: string, entryId: string): Promise<void>` — entry owned by user AND has an `exerciseId` (self-guided entries are never shareable) AND that exercise's link is active, else `NotFoundError`; sets `sharedAt` (idempotent); audit `entry_shared` (actor = client).
- `listEntriesForClient(userId: string): Promise<{ id: string; exerciseId: string | null; payload: ThoughtRecordPayload; sharedAt: Date | null; createdAt: Date }[]>` — decrypted, newest first, corrupt-row isolation.
- `listAssignmentsForTherapist(therapistId: string, clientId: string): Promise<{ id: string; type: string; instruction: string; status: string; createdAt: Date; entryCount: number; lastEntryAt: Date | null; sharedEntryIds: string[] }[]>` — active link required; engagement counts ALL entries (shared or not); instruction decrypts with the client's DEK; **no entry content here**.
- `getSharedEntryForTherapist(therapistId: string, entryId: string): Promise<{ payload: ThoughtRecordPayload; createdAt: Date }>` — entry must have `sharedAt` set AND belong to an exercise whose link is active and owned by this therapist, else `NotFoundError`; audits `entry_viewed` deduped 15 min.

**Adversarial test list (write FIRST):** assign without link / to a foreign client → NotFoundError; unshared entry via `getSharedEntryForTherapist` → NotFoundError (content invisible while `entryCount` includes it — one test proves both halves); shared entry after link revoke → NotFoundError; self-guided entry share attempt → NotFoundError; foreign therapist on assignments/entry → NotFoundError; close by non-assigner → NotFoundError; ciphertext-at-row for instruction AND entry payload + cross-key non-decryption; saveEntry against another client's exercise → NotFoundError; engagement never contains payload fields.

Commits: `✨ Assign thought-record homework through the therapist link` + `✨ Keep completed thought records private until each is shared`.

---

### Task 5: Chat route integration + AI-guided extraction (TDD)

**Files:** modify `src/app/api/chat/route.ts`, `src/lib/ai/system-prompt.ts`, `src/lib/ai/models.ts`; tests beside existing route tests.

- **Mood in context:** in `handlePost`, load `listMoodCheckins(userId, 14)` and `buildMoodContextLine(...)`; when non-null, append to `system` as `\n\n${line}` immediately after `buildSystemPrompt()` — BEFORE therapist guidance, and the crisis addendum stays LAST (extend the existing ordering test).
- **Homework in context:** `system-prompt.ts` gains `buildHomeworkSection(exercises: { type: string; instruction: string }[]): string | null` — null when empty; otherwise a section telling the model the client has active exercises (list instructions, clamped 300 chars each, max 3 newest), it may gently weave them in and, when asked to "walk me through it", guide ONE column at a time (situation → thoughts → emotions → behavior → optional body sensations), never rushing, never forcing. Route appends it for `listExercisesForClient(userId)` actives — client-visible data, **no grant check by design** (spec).
- **Extraction endpoint:** `models.ts` gains `getExtractorModel()` (mock returns `JSON.stringify({ situation: "Mock situation", thoughts: "Mock thoughts", emotions: "Mock emotions", behavior: "Mock behavior" })`; real = classifier default model). New route `POST /api/exercises/extract` `{ conversationId }` — session → ownership via `loadMessages(conversationId, userId)` (throws NotFoundError for foreign) → last 30 messages, client+ai only, plaintext transcript → `generateObject({ model: getExtractorModel(), schema: thoughtRecordSchema, maxOutputTokens: 1024, abortSignal: AbortSignal.timeout(15_000) })` → **returns the payload, persists NOTHING** (the client confirms in the prefilled form; saving is Task 6's entries route). 502 `{ error: "Could not extract an entry" }` on model failure; rate-limit with `chatRateLimiter`.
- **Tests (mock models):** mood line present in the mock's received system prompt when check-ins exist, absent otherwise, never after the crisis addendum; homework section present only with active assignments, closed ones drop out; ordering test asserts base < mood < homework < guidance < crisis; extract returns payload for owner, 404 foreign, 401 unauthenticated, nothing persisted (entries table empty after call).

Commit `✨ Let the AI feel the week and guide the homework it knows about`.

---

### Task 6: Client API routes (TDD)

**Files:** create `src/app/api/mood/route.ts`, `src/app/api/mood/sharing/route.ts`, `src/app/api/exercises/route.ts`, `src/app/api/entries/route.ts`, `src/app/api/entries/[entryId]/share/route.ts`; modify `src/app/api/trust/route.ts` (add `moodShared: boolean`).

Established discipline per handler: session → 401 → rate limit where sensible → zod parse → 400 → domain call → NotFoundError → 404.

- `POST /api/mood` `{ score: number; note?: string }` → `checkInMood`; 204. Rate-limit: `conversationCreateRateLimiter` pattern — add `export const moodRateLimiter = new RateLimiter({ capacity: 10, refillWindowMs: 5 * 60 * 1000 })` to `rate-limit.ts`.
- `GET /api/mood?days=56` → `{ checkins: MoodCheckin[] }` (days clamped 1–366, default 56).
- `PUT /api/mood/sharing` `{ enabled: boolean }` → `setMoodSharing`; 204; 404 without active link.
- `GET /api/exercises` → `{ exercises: [...] }` via `listExercisesForClient` + `{ entries: [...] }` via `listEntriesForClient` (one payload for the client surfaces).
- `POST /api/entries` `{ exerciseId?: string; payload: ThoughtRecordPayload }` → `saveEntry`; 201 `{ id }`; rate-limit `moodRateLimiter` semantics — add `entryRateLimiter` (capacity 10 / 5 min).
- `POST /api/entries/[entryId]/share` → `shareEntry`; 204.
- `GET /api/trust` response gains `moodShared` via `getMoodSharingState`.

**Route tests:** 401 each; 404 adversarial passthroughs (foreign entry share, sharing toggle without link); 400 malformed payloads (score 7, empty situation); 429 when the bucket drains; trust includes `moodShared` both states.

Commit `✨ Manage mood and homework over the client API`.

---

### Task 7: Therapist API routes (TDD)

**Files:** create `src/app/api/therapist/conversations/[conversationId]/digest/route.ts`, `src/app/api/therapist/clients/[clientId]/mood/route.ts`, `src/app/api/therapist/clients/[clientId]/exercises/route.ts`, `src/app/api/therapist/exercises/[exerciseId]/route.ts`, `src/app/api/therapist/entries/[entryId]/route.ts`.

Every handler role-checks `therapist` via the existing `src/app/api/therapist/_lib` helper AND flows through domain functions that gate internally; 404 for everything adversarial.

- `GET .../digest` → `getOrRefreshDigest`; 200 `{ digest: DigestForTherapist | null }` (null = "unavailable right now", the route never fabricates).
- `GET .../mood` → `getMoodTrendForTherapist`; `{ trend: { day; score }[] }`.
- `GET .../exercises` → `listAssignmentsForTherapist`; `POST .../exercises` `{ type: "thought_record"; instruction: string }` → `assignExercise`; 201 `{ id }`; rate-limit `therapistWriteRateLimiter`.
- `PATCH /api/therapist/exercises/[exerciseId]` `{ status: "closed" }` → `closeExercise`; 204.
- `GET /api/therapist/entries/[entryId]` → `getSharedEntryForTherapist`; `{ entry: { payload; createdAt } }`.

**Route tests:** client-role caller → 404 on every handler; ungranted digest → 404; toggle-off mood → 404; unshared entry → 404; assign to unlinked client → 404; 429 on assignment flood.

Commit `✨ Serve digests, mood trends, and homework over gated therapist APIs`.

---

### Task 8: Client UI — mood (design skills mandatory)

**Files:** modify `src/components/chat/stats-rail.tsx` (live sparkline replaces the "How the weeks have felt" placeholder — drop its `SoonPill`), home screen (one-tap check-in), `src/components/trust/trust-screen.tsx` (mood toggle), the server components that feed them; new `src/components/chat/mood-checkin.tsx` + `src/components/chat/mood-sparkline.tsx`.

- **Check-in:** a quiet one-tap row (5 mood glyphs, 1–5) on the home screen near the hero; tapping posts to `/api/mood` and settles into a "checked in today" state (today's value pre-selected, tappable to change — same-day upsert). Optional note: a small "add a word about it" disclosure, never demanded. Twilight-journal tokens; transitions per `transitions-dev`; reduced-motion respected.
- **Sparkline:** last ~8 weeks in the stats rail panel, pure SVG (no packages), warm accent stroke, dot per check-in, empty state keeps today's placeholder copy. `aria-label` summarizing ("Mood over the last 8 weeks, N check-ins").
- **Trust toggle:** on `/trust`, next to the sharing list: "Share my mood trend" with the exact honest sub-copy "Scores and dates only — never your notes." Default off; only rendered with an active link; optimistic flip with revert-on-error.

Commit `💄 Let the weeks show how they felt: mood check-ins and the live sparkline`.

---

### Task 9: Client UI — thought records (design skills mandatory)

**Files:** create `src/app/exercises/page.tsx` + `src/components/exercises/worksheet-form.tsx`, `entry-list.tsx`, `share-prompt.tsx`; modify home screen (assignment surface) and `src/components/chat/chat-screen.tsx` (quiet affordance + extraction path).

- **Worksheet form** (mobile-first, the paper columns as a vertical flow): when it happened (optional), the situation/trigger, thoughts (placeholder: `What went through your mind? e.g. "They probably think I'm an idiot"`), emotions (placeholder: `e.g. anxiety, anger, shame, disgust`), behavior (placeholder: `What did you do? e.g. avoided the situation`), body sensations (optional). Saves via `POST /api/entries`; on success, IF the entry belongs to an assignment with a live link, the one non-coercive share prompt: "Share this entry with {therapistName}? You can keep it private — it still counts as done." Buttons "Share this entry" / "Keep it private"; decline is final for that entry (no nagging).
- **Assignment surface:** active assignments on the home screen ("From {name}: …instruction…" card → worksheet) and `/exercises` lists assignments + past entries (shared-state marked quietly). **Standalone law:** `/exercises` always offers "Start a thought record" with no assignment and no therapist — the same form, saving a self-guided entry (`exerciseId` omitted, no share prompt).
- **AI-guided path:** in a chat, a quiet affordance ("Walk through a thought record") that seeds the composer with a fixed line ("Can you walk me through a thought record?") — the model (Task 5's homework section) guides column by column; afterwards a "Save what we worked out" action calls `POST /api/exercises/extract` and opens the worksheet form PREFILLED for the client to correct and confirm — extraction never saves silently.
- e2e hooks: stable labels/roles for Task 11.

Commit `💄 Give thought records a home: the worksheet, the walk-through, the choice`.

---

### Task 10: Therapist UI (design skills mandatory)

**Files:** modify `src/components/therapist/reading-view.tsx` (digest panel), `src/components/therapist/client-conversations.tsx` / client view (mood trend + assignments panel); new `src/components/therapist/digest-panel.tsx`, `mood-trend.tsx`, `exercise-panel.tsx`.

- **Digest panel:** top of the reading view, collapsed to one calm line ("Session digest — covers up to …") that expands; "Preparing digest…" while `GET .../digest` runs; themes as quiet chips, overview as prose, anchors as links that scroll to their message with the crisis-navigator's gentle landing (reuse its scroll/highlight mechanics); `kind: "risk"` anchors wear the warm-amber crisis treatment, never red; `stale: true` says exactly what it covers; `null` → "Digest unavailable right now" — never fabricated.
- **Mood trend:** on the client view, rendered ONLY when the API returns data (toggle on): same sparkline component family as the client's, labeled "Shared by {clientName}"; 404 → panel absent entirely (no "client hasn't enabled" leak — absence is indistinguishable).
- **Exercise panel:** on the client view: assign form (type fixed to thought record, instruction textarea with the deliberate framing "This will appear to {name} as from you"), assignment list with engagement ("2 entries, last Tuesday"), shared entries readable inline (worksheet-shaped read-only), close action.

Commit `💄 Bring digests, mood, and homework to the therapist's desk`.

---

### Task 11: e2e + docs

**Files:** extend `e2e/therapist.spec.ts` (journey) + `e2e/chat.spec.ts` or `e2e/desktop.spec.ts` (mood, worksheet — put each spec in the project whose viewport it needs); modify `README.md`.

- **Client e2e:** mood tap → "checked in today" state → sparkline dot appears; worksheet form → entry listed under `/exercises`.
- **Journey additions (two contexts, mock models):** therapist assigns a thought record → client sees the assignment → completes the worksheet → shares via the prompt → therapist sees engagement AND reads the shared entry; therapist opens the shared conversation → digest panel renders mock content, an anchor click lands (reuse the crisis-nav landing assertions); client flips the mood toggle → therapist's client view shows the trend; toggle off → panel gone.
- **Adversarial e2e:** revoke link → digest request 404s and the desk shows no mood/exercise panels (existing revocation spec extended).
- **README Privacy Model additions (exact, honest):** digests are AI-derived content — plaintext transits the LLM at generation, like replies; mood scores are encrypted at rest and leave your view only via the explicit toggle (scores + dates, never notes); thought-record entries are private by default and shared one at a time, and engagement counts are visible to the assigning therapist.

Commits: `✅ Walk mood, homework, and digests end-to-end` + `📝 Document the enrichments honestly`.

---

## Verification (whole sub-project)

1. Full suites green (report final counts; expect ~60-80 new unit tests, e2e 15 → ~19).
2. Ciphertext spot-checks: `mood_checkins.payload_ciphertext`, `digests.body_ciphertext`, `exercises.instruction_ciphertext`, `exercise_entries.payload_ciphertext` all `v1.…` blobs; cross-key non-decryption proven in tests for each.
3. The adversarial suite is the release criterion: digest pre/post-revoke, mood toggle tri-state, unshared-entry invisibility, foreign-everything → 404.
4. Manual two-account drive (user validation): assign → complete → share → read; digest render + anchor jump; mood toggle both ways; revoke kills all three surfaces.
5. Human validation → review gate on the most capable model (mandatory tail).
