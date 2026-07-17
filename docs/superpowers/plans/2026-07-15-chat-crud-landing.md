# Chat CRUD (Branching) + Public Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ChatGPT-parity chat interactions (edit-as-branch, regenerate, version navigation, stop, copy, hide-with-restore) on the encrypted therapist-shared model, plus a public landing page with favicon and honest SEO/AEO.

**Architecture:** Messages become a tree (`parent_id` self-reference; `conversations.active_leaf_id` names the client's current path). Every consumer of "the conversation" reads the active path through one pure path-resolution module; the therapist reads the whole tree with view-local navigation. Deletion is a `hidden_at` timestamp the therapist side ignores. The landing replaces the root redirect for signed-out visitors.

**Tech Stack:** Next.js 16.2.9 (App Router), Bun, Postgres 17 + Drizzle 0.45.2 (drizzle-kit 0.31.10), AI SDK v6 (`ai@6.0.214`, `@ai-sdk/react@3.0.216`), Tailwind v4, Vitest (real Postgres), Playwright.

**Spec:** `docs/superpowers/specs/2026-07-15-chat-crud-landing-design.md`

## Global Constraints

- **Nothing is ever destroyed by editing.** Edits/regenerations create sibling message rows; no code path row-deletes messages.
- **The active path is the one shared definition:** walk up from `active_leaf_id` to the root, reversed. AI context (last 30 of it), digest transcripts, the client's rendered conversation, and exports all read the active path. Siblings order by `(created_at, id)`. Switching to a sibling moves the leaf to that sibling's **deepest descendant following the latest child at each step**.
- **Therapist surfaces IGNORE `hidden_at` entirely** — the gate, listings, reading view, digests, attention queue. Client surfaces exclude hidden everywhere and offer a restorable Hidden section.
- **Therapist branch navigation is view-local** — it never touches the client's `active_leaf_id`.
- **Stop persists exactly the streamed prefix** — no appended marker text, no fake completion; the partial is a normal message.
- **Crypto laws unchanged:** new/edited versions are fresh ciphertext under the owner's DEK; `parent_id`/`active_leaf_id`/`hidden_at` are ids+times only.
- **Uniform 404** (`NotFoundError` → `{ error: "Not found" }`) for foreign/missing on every new route; 401 unauth first; zod 400s; else rethrow.
- **System-prompt total order unchanged** (base → mood → homework → guidance → crisis LAST); notes never in prompt; the existing chat-route pins must stay green.
- **Rate limits:** edit/regenerate ride `chatRateLimiter` (they are model calls — they hit the same POST /api/chat). Hide/restore/switch ride a new `conversationMutateRateLimiter` (capacity 30, refillWindowMs 5 \* 60 \* 1000), 429 body `{ error: "A gentle pace — try again in a moment" }`.
- **Landing claims only what the product does** — no fabricated testimonials or numbers; privacy copy mirrors the README's honest model. `metadataBase` = `https://tellmewhy.huyakhuyak.productions`. Authenticated surfaces are `noindex` and robots-disallowed.
- **No new runtime packages.** One-off asset generation may use `bunx` tooling at dev time only.
- **Copy tone** calm/honest; errors `role="alert"` + `font-serif italic text-accent` (client) / `text-crisis-muted` (therapist); pacing copy family: "A gentle pace — …".
- Migrations are GENERATED (`bun run db:generate`); the data backfill uses `bunx drizzle-kit generate --custom` (supported in 0.31.10) — never hand-edit `meta/`.
- **IDE diagnostics in this repo are frequently stale/false.** Trust `bunx tsc --noEmit`, `bun run lint`, `bun run build`, and the test runners only.
- Unit tests run against real Postgres (`bun run test`); e2e `bun run test:e2e` (30 tests must stay green). Commits: gitmoji, one behavior each, tests ride with their behavior.

---

### Task 1: Schema + backfill — the tree and the hide flag

**Files:**
- Modify: `src/db/schema.ts` (`messages` ~line 61, `conversations` ~line 41)
- Create: `drizzle/0013_*.sql` (generated), `drizzle/0014_*.sql` (custom data backfill)

**Interfaces:**
- Produces: `messages.parentId` (uuid, nullable, self-FK), `conversations.activeLeafId` (uuid, nullable, no FK), `conversations.hiddenAt` (timestamp, nullable). Tasks 2+ consume these exact camelCase names.

- [ ] **Step 1: Schema edits**

In `messages`, after `conversationId`:

```ts
    // Tree edge: the message this one answers/follows. Null = the
    // conversation's root. Messages are never row-deleted, so no cascade
    // semantics matter here; sibling groups (same parent) are the version
    // sets the < n/m > switcher navigates.
    parentId: uuid("parent_id").references((): AnyPgColumn => messages.id),
```

(add `import type { AnyPgColumn } from "drizzle-orm/pg-core";` — the lazy self-reference needs the explicit return type) and extend the table's index list:

```ts
  (table) => [
    index("messages_conversation_id_idx").on(table.conversationId),
    index("messages_parent_id_idx").on(table.parentId),
  ],
```

In `conversations`, after `titleCustomized`:

```ts
    // The leaf whose ancestor chain is the client's current path. No FK:
    // a circular messages<->conversations FK complicates nothing useful —
    // messages are never deleted, and an fk here would fight the
    // messages.conversation_id cascade on conversation deletion.
    activeLeafId: uuid("active_leaf_id"),
    // "Delete" in the UI = hide from the client's own view. Therapist
    // surfaces ignore this entirely; account deletion (crypto-shredding)
    // remains the one true delete.
    hiddenAt: timestamp("hidden_at"),
```

- [ ] **Step 2: Generate the schema migration**

Run: `bun run db:generate` → new `drizzle/0013_*.sql` with the three ADD COLUMNs, the self-FK, and the parent index.

- [ ] **Step 3: Custom data backfill migration**

Run: `bunx drizzle-kit generate --custom --name=tree_backfill` → empty `drizzle/0014_tree_backfill.sql`. Fill it:

```sql
-- Custom SQL migration file, put your code below! --
-- Wire the existing linear history into the tree: each message's parent is
-- the previous message of its conversation; each conversation's active leaf
-- is its last message. Replay-safe: on an empty database both UPDATEs touch
-- zero rows.
WITH ordered AS (
  SELECT id,
         lag(id) OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS prev_id
  FROM messages
)
UPDATE messages m SET parent_id = o.prev_id
FROM ordered o
WHERE m.id = o.id AND o.prev_id IS NOT NULL AND m.parent_id IS NULL;--> statement-breakpoint
UPDATE conversations c SET active_leaf_id = last.id
FROM (
  SELECT DISTINCT ON (conversation_id) conversation_id, id
  FROM messages
  ORDER BY conversation_id, created_at DESC, id DESC
) last
WHERE c.id = last.conversation_id AND c.active_leaf_id IS NULL;
```

- [ ] **Step 4: Apply + verify**

Run: `bun run db:migrate` → success. `bunx tsc --noEmit` clean. `bun run test` → all existing tests pass (additive columns; existing writes leave `parentId`/`activeLeafId` null until Task 2 — verify no test asserts column sets).

- [ ] **Step 5: Backfill proof (manual, dev DB)**

Seed a 3-message conversation via any existing test (or psql), re-run the two backfill statements manually, and confirm `parent_id` chains and `active_leaf_id` = last id. Record the check in your report.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit  # 🗃️ Turn message history into a tree and give conversations a hide flag
```

---

### Task 2: The tree domain — pure path math + conversations.ts tree writes/reads + hide domain

**Files:**
- Create: `src/lib/message-tree.ts`, `src/lib/message-tree.test.ts`
- Modify: `src/lib/conversations.ts` (saveMessage, loadMessages, listConversations; new exports)
- Test: `src/lib/conversations.test.ts`

**Interfaces (Tasks 3–9 rely on these EXACT signatures):**
- `src/lib/message-tree.ts` (pure, no DB, importable from client components):
  - `export type TreeNode = { id: string; parentId: string | null; createdAt: Date }`
  - `resolveActivePath(nodes: TreeNode[], activeLeafId: string | null): string[]` — leaf's ancestor chain, root-first. Unknown/null leaf → fall back to `deepestDescendant` of the latest root (created-at order); empty nodes → `[]`.
  - `siblingsOf(nodes: TreeNode[], id: string): string[]` — same `parentId` (null-safe), ordered `(createdAt, id)`.
  - `deepestDescendant(nodes: TreeNode[], id: string): string` — follow the latest child (`(createdAt, id)` max) to a leaf.
  - `versionInfo(nodes: TreeNode[], pathIds: string[]): Map<string, { index: number; count: number; siblings: string[] }>` — entries only where count > 1.
  - `projectMarkerOntoPath(nodes: TreeNode[], pathIds: string[], markerId: string | null): string | null` — markerId on the path → itself; else the last path id with `createdAt <=` marker's createdAt; null marker/none-qualify → null.
- `src/lib/conversations.ts`:
  - `saveMessage(input: { conversationId; userId; sender: Sender; text; riskLevel?; parentId?: string | null })` — `parentId` undefined = append to the conversation's current `activeLeafId`; explicitly provided (uuid or null) = branch there after validating the parent belongs to this conversation (foreign/missing parent → `NotFoundError`). SAME transaction: the append reads `active_leaf_id` under `SELECT … FOR UPDATE` so concurrent appends serialize per conversation instead of racing into accidental siblings (`setActiveLeaf` — and interventions through it — take the same conversation-row lock), then insert row (with resolved parentId) + `update conversations set activeLeafId = <new id>, updatedAt = now()`.
  - `loadMessages(conversationId, userId)` — NOW RETURNS THE ACTIVE PATH (all existing consumers become path-aware for free), each row gaining `parentId: string | null`. Fallback when `activeLeafId` is null but messages exist: resolve via `resolveActivePath` fallback.
  - `loadMessageTree(conversationId, userId): Promise<{ messages: LoadedMessage[]; riskById: Map<string, RiskLevel>; activeLeafId: string | null }>` — ALL rows (flat, `(createdAt, id)` asc, decrypted, corrupt-row skip), same fields as loadMessages rows. `riskById` carries every message's stored risk level off its RAW row (a plaintext column), so it survives ciphertext corruption that would drop a body — the crisis-carry seam a regenerate reads its parent's risk from.
  - `setActiveLeaf(conversationId, userId, messageId): Promise<void>` — validates the message belongs to the conversation (else `NotFoundError`), sets `activeLeafId = deepestDescendant(messageId)`.
  - `setConversationHidden(conversationId, userId, hidden: boolean): Promise<void>` — sets/clears `hiddenAt` (requireOwnedConversation first).
  - `listConversations(userId)` — adds `where isNull(hiddenAt)` (plus the existing owner filter).
  - `listHiddenConversations(userId)` — same shape as listConversations + `hiddenAt: Date`.

- [ ] **Step 1: Failing pure-module tests (`message-tree.test.ts`)**

Real assertions for: linear chain resolves in order; branch at node B with two children resolves through the leaf's side; `siblingsOf` orders by createdAt then id and treats root siblings (parentId null) as one group per conversation-set passed in; `deepestDescendant` follows the LATEST child at each level (build a fork where the older child has a deeper subtree — the newer shallow child must win at its own level, then continue deepest-latest below); `versionInfo` reports `{index,count,siblings}` only for branched path nodes with correct 0-based index; `projectMarkerOntoPath` — on-path marker returns itself; off-path marker projects to the last earlier-or-equal path node; marker older than everything → null; null marker → null; unknown-leaf fallback returns the latest root's deepest chain; empty input → [].

- [ ] **Step 2: RED → implement `message-tree.ts` → GREEN**

Pure functions over `Map<string, TreeNode>` + children index built once per call. Comparator: `(a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)`. No DB imports, no React — this module is shared by server libs and client components.

- [ ] **Step 3: Failing conversations.ts tests**

In `conversations.test.ts` (real Postgres, existing harness): append chains `parentId` automatically and moves the leaf; explicit `parentId` branches (two children under one parent; leaf = newest); explicit foreign/missing parent → `NotFoundError`; `loadMessages` returns only the active path after a branch (old branch absent) and includes `parentId`; `loadMessageTree` returns everything; `setActiveLeaf` flips paths (and lands on the DEEPEST descendant when switching to a subtree that has children); hide → `listConversations` excludes + `listHiddenConversations` includes with `hiddenAt`; restore reverses; hide of foreign conversation → `NotFoundError`; legacy shape: a conversation with messages but `activeLeafId` null (insert rows directly, bypassing saveMessage) still loads chronologically via the fallback.

- [ ] **Step 4: RED → implement → GREEN**

`saveMessage`'s transaction (recon shows the current one at conversations.ts:53-78) grows: resolve parent (undefined → `SELECT active_leaf_id`), validate explicit parent via one select on `(id, conversationId)`, insert with `parentId`, then `set({ activeLeafId: row.id, updatedAt: new Date() })`. `loadMessages` = `loadMessageTree` + `resolveActivePath` + filter/order by the path. Keep the corrupt-row flatMap discipline and `errorCause` logs.

- [ ] **Step 5: Full suite + gates**

`bun run test` — expect fallout ONLY in tests that asserted flat `loadMessages` shape (they now still pass: linear conversations' active path IS the flat order). Investigate any other failure before proceeding. `bunx tsc --noEmit`, `bun run lint`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/message-tree.ts src/lib/message-tree.test.ts src/lib/conversations.ts src/lib/conversations.test.ts
git commit  # ✨ Messages form a tree: branch-aware saves, active-path reads, hide domain
```

---

### Task 3: Chat route — branch sends, regenerate, honest stop

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Test: `src/app/api/chat/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `saveMessage` (parentId), `loadMessages` (active path), `loadMessageTree`.
- Produces the wire contract Tasks 6/12 rely on:
  - Send/edit: `POST /api/chat` `{ conversationId, text, parentId?: uuid | null }` — parentId present ⇒ branch (edit); absent ⇒ append.
  - Regenerate: `POST /api/chat` `{ conversationId, regenerateOf: uuid }` — new AI sibling under that AI message's parent; NO client message saved; no risk classification run.
  - Stop: aborting the request persists exactly the streamed prefix as the AI message.

- [ ] **Step 1: Failing tests**

Using the existing harness (`MockLanguageModelV3` via spied `getChatModel`, real DB, `await res.text()` to drain):

```ts
it("an edit branches: the new client message is a sibling of the edited one", async () => {
  // seed: send m1 -> reply r1; send m2 -> reply r2 (normal POSTs)
  // then POST { conversationId, text: "edited", parentId: <m2.parentId> }  (= r1.id)
  // assert via loadMessageTree: new client message's parentId === r1.id (sibling of m2),
  // new AI reply is its child, activeLeafId === new reply, and m2/r2 rows still exist.
});

it("regenerate creates an AI sibling and moves the leaf", async () => {
  // seed m1 -> r1; POST { conversationId, regenerateOf: r1.id }
  // tree: two AI children under m1; leaf = the newer; loadMessages (path) shows m1 + new reply;
  // no new client message rows; assessRisk NOT called for this POST (spy on classifier model calls).
});

it("regenerateOf rejects a non-AI or foreign message with 404", async () => { /* client-message id → 404; other user's message id → 404 */ });

it("aborting the stream persists exactly the streamed prefix", async () => {
  // Build a MockLanguageModelV3 whose doStream emits chunks with delays and honors
  // options.abortSignal (throw AbortError after N chunks when aborted).
  // POST with a Request carrying an AbortController signal; abort after the first chunks arrive;
  // then poll loadMessages until the AI row appears; assert its text is a strict non-empty
  // prefix of the full mock reply and shorter than it.
});

it("the AI context is the ACTIVE PATH, not the whole tree", async () => {
  // branch as in the edit test, then send a normal message; capture lastChatPrompt()
  // and assert the superseded branch's text (m2) is ABSENT from the model messages.
});
```

Keep every existing pin green (total order, notes absence, homework order).

- [ ] **Step 2: RED, then implement**

Body schema:

```ts
const sendSchema = z.object({
  conversationId: z.uuid(),
  text: z.string().min(1).max(8000),
  // Present = branch here (edit): the new message becomes a sibling of
  // whatever else shares this parent. null = branch at the root.
  parentId: z.uuid().nullable().optional(),
});
const regenerateSchema = z.object({ conversationId: z.uuid(), regenerateOf: z.uuid() });
const bodySchema = z.union([sendSchema, regenerateSchema]);
```

Handler flow:
- **Send/edit:** `assessRisk` as today → `saveMessage({ ..., parentId: parsed.parentId })` (undefined passes through as append) → `loadMessages` (now the active path including the new message) → unchanged context/system assembly.
- **Regenerate:** verify the target via `loadMessageTree` (owner check happens inside) — must exist and `sender === "ai"`, else `NotFoundError`; context = the active-path-style chain ENDING AT ITS PARENT: compute with `resolveActivePath(treeNodes, target.parentId)` (parent null ⇒ empty context is invalid — a root AI message can't exist; treat as 404). Build `uiMessages` from that chain; reuse the STORED parent risk for the `x-risk-level` header (`tree.riskById.get(target.parentId) ?? "none"`, read off the RAW row so a corrupt-decrypt parent still reports its true risk) — never re-run the classifier, never blanket-default to `"none"`; DO NOT save a client message. In persistence, the AI row saves with `parentId: target.parentId`.
- **Persistence moves to the abort-aware callback.** Replace the `streamText`-level `onFinish` with:

```ts
    const result = streamText({
      model: getChatModel(),
      maxOutputTokens: 1024,
      system,
      messages: await convertToModelMessages(uiMessages),
      // Stop/tab-close abort the model call itself; the streamed prefix is
      // what gets persisted below — an honest partial, never a fake whole.
      abortSignal: req.signal,
    });

    result.consumeStream();

    return result.toUIMessageStreamResponse({
      headers: { "x-risk-level": riskLevel },
      onFinish: async ({ responseMessage, isAborted }) => {
        const replyText = responseMessage.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");
        if (!replyText) return; // aborted before any token — nothing honest to save
        try {
          await saveMessage({ conversationId, userId, sender: "ai", text: replyText, parentId: aiParentId });
        } catch (error) {
          console.error(`Failed to persist AI reply for conversation ${conversationId} (${errorCause(error)})`);
        }
        if (!isAborted) { /* existing auto-title block, verbatim, keyed on the send path's history.length === 1 */ }
      },
    });
```

where `aiParentId` = the just-saved client message id (send path) or `target.parentId` (regenerate path). **Verification duty:** the recon notes `toUIMessageStreamResponse`'s `onFinish` carries `isAborted` + `responseMessage` (ai@6.0.214 `UIMessageStreamOnFinishCallback`); if in practice it does not fire on an aborted request even with `consumeStream()`, fall back to `streamText`'s `onAbort` (reconstruct text from `steps`) plus `onFinish` for the normal path — and document which path shipped in your report. The abort unit test is the arbiter.

- [ ] **Step 3: GREEN + gates**

`bun run test src/app/api/chat` all green (new + every existing pin), then full `bun run test`, `bunx tsc --noEmit`, `bun run lint`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit  # ✨ Edits branch, replies regenerate, and stopping keeps the honest partial
```

---

### Task 4: Conversation routes — switch, hide, restore

**Files:**
- Modify: `src/lib/rate-limit.ts` (+`conversationMutateRateLimiter`, capacity 30 / 5min)
- Modify: `src/app/api/conversations/[conversationId]/route.ts` (PATCH gains `hidden`)
- Create: `src/app/api/conversations/[conversationId]/active-leaf/route.ts` (POST `{messageId}` → 204)
- Test: both `route.test.ts` files (extend / create)

**Interfaces:**
- Consumes: `setActiveLeaf`, `setConversationHidden` (Task 2).
- Produces: `PATCH /api/conversations/[id]` body may now be `{ hidden: boolean }` (alone or with title/folderId; `.refine` updated to accept any one); `POST /api/conversations/[id]/active-leaf` `{ messageId: uuid }` → 204. Both consume `conversationMutateRateLimiter` AFTER auth, 429 body `{ error: "A gentle pace — try again in a moment" }`.

- [ ] **Step 1: Failing route tests** — hidden PATCH round-trip (hide → listConversations GET excludes; restore → returns); foreign conversation 404; active-leaf switch flips `loadMessages` output (seed a branch via two `saveMessage` calls with explicit parents); foreign/cross-conversation messageId → 404; 401s; 429 by draining the new limiter (drain-loop test LAST); draining it leaves `chatRateLimiter` untouched (isolation pin, mirroring the create-limiter test).
- [ ] **Step 2: RED → implement → GREEN.** PATCH: add `hidden: z.boolean().optional()` to `bodySchema`, extend the `.refine`, handle before/alongside folder+title (`if (body.data.hidden !== undefined) await setConversationHidden(...)`), add the limiter consume after auth (rename/move/hide are all mutations — apply the limiter to the whole PATCH; existing rename tests must still pass, adjust only if a test drains it). New active-leaf route: clone the share-route shape (async params, zod, 404 mapping).
- [ ] **Step 3: Full suite + gates.**
- [ ] **Step 4: Commit**

```bash
git add src/lib/rate-limit.ts src/app/api/conversations
git commit  # ✨ Switch branches, hide and restore conversations over the API
```

---

### Task 5: Therapist seams — whole-tree reads, projected review line, path-aware digests, hide-blindness

**Files:**
- Modify: `src/lib/therapist-access.ts` (loadSharedMessages + SharedMessage type), `src/lib/therapist-desk.ts` (getReadingView, getClientConversations unread math), `src/lib/digests.ts` (idRows → active path), `src/lib/interventions.ts` (attach to the leaf), `src/components/therapist/attention-queue.tsx` link (+`?focus=`)
- Test: `src/lib/therapist-access.test.ts`, `src/lib/therapist-desk.test.ts`, `src/lib/digests.test.ts`, `src/lib/interventions.test.ts`, `src/lib/sharing.test.ts`

**Interfaces:**
- `SharedMessage` gains `parentId: string | null` and keeps `createdAt`.
- `getReadingView` returns `ReadingView & { activeLeafId: string | null }`; its `messages` become the WHOLE tree (flat, `(createdAt, id)` asc) each with `parentId`/`createdAt`; `markerMessageId` unchanged (raw, un-projected — the view projects per displayed path using `projectMarkerOntoPath`).
- `sendIntervention` saves with `parentId = current activeLeafId` and moves the leaf (route through Task 2's `saveMessage` if its ownership shape permits — it takes the CLIENT's userId, which `sendIntervention` has from the gate — otherwise mirror the transaction; keep the `intervention_sent` audit and sender/authorId exactly as today). Its 201 `{ id }` response is a consumed contract: the reading view adopts that id into `viewLeafId` so the new intervention lands on the therapist's displayed path immediately.
- Digests: `idRows` becomes the ACTIVE PATH (`resolveActivePath` over all ids+parents+createdAt, leaf from the conversations row); `newestMessageId` = path leaf; `validMessageIds` = path set. Everything else (CAS, filterAnchors, incremental window) operates on the path unchanged.
- Attention queue: whole tree, unchanged query; the queue Link gains `?focus=${entry.messageId}` (consumed by Task 8's reading view).
- Unread math (`getClientConversations`): time-based — unread = count of messages (whole tree) with `createdAt >` the marker message's `createdAt`; no marker → total count. (Replaces the flat-index math; branch-stable.)

- [ ] **Step 1: Failing tests**

- therapist-access: `loadSharedMessages` returns BOTH branches after a client edit (seed branch via saveMessage explicit parent); hidden conversation (hiddenAt set) still loads + still passes the gate; `advanceReviewMarker` accepts a message on an inactive branch.
- therapist-desk: `getReadingView` exposes `activeLeafId` + whole tree; unread math — marker at m2 of [m1,m2,branchA,branchB] counts messages created after m2 regardless of branch; hidden conversation still appears in `getClientConversations`/`listGrantedConversations` (adversarial: hide must change NOTHING therapist-visible — pin with a direct equality of before/after listing).
- digests: transcript covers only the active path (branch content absent from the prompt — capture via the digest mock's transcript marker); staleness triggers on `setActiveLeaf` (leaf moved, same rows); anchors from a superseded branch drop via the path-scoped validMessageIds.
- interventions: an intervention lands as a child of the current leaf and moves it.

- [ ] **Step 2: RED → implement → GREEN.** `loadSharedMessages` keeps its flat whole-tree query (add parentId to the select); path resolution happens where a path is needed (digests) via `message-tree` helpers. Digest change is localized to the `idRows` construction (recon: digests.ts:67-77): fetch `id, parentId, createdAt` + the conversation's `activeLeafId`, then `const pathIds = resolveActivePath(nodes, activeLeafId)` and rebuild `idRows` in path order.
- [ ] **Step 3: Full suite + gates.**
- [ ] **Step 4: Commit**

```bash
git add src/lib/therapist-access.ts src/lib/therapist-desk.ts src/lib/digests.ts src/lib/interventions.ts src/components/therapist/attention-queue.tsx src/lib/*.test.ts
git commit  # 🛂 The therapist reads the whole tree; digests and unread follow the client's path
```

---

### Task 6: Client chat — edit, regenerate, stop (the useChat mechanics)

**Files:**
- Modify: `src/components/chat/chat-screen.tsx` (transport, destructure `stop`/`regenerate`, composer stop control, edit mode)
- Create: `src/components/chat/message-edit.tsx` (inline edit composer)
- Test: gates (tsc/lint/build) + Task 12 e2e; any pure logic extracted (e.g. a `buildChatRequestBody` helper) gets a unit test file

**Interfaces:**
- Consumes: Task 3's wire contract; `metaById` must now carry `parentId` (Task 7 threads it from the page — coordinate: THIS task adds `parentId` to the `initialMessages` prop type and the page mapping, Task 7 consumes it further).
- Produces: `MessageEdit({ initialText, onSave(text), onCancel })`; transport that maps `trigger`/`messageId` to the Task 3 body; a Stop control replacing the send button while streaming.

- [ ] **Step 1: Extract + test the request-body mapping**

Create a pure helper in `src/lib/chat-request.ts`:

```ts
export type ChatTrigger = "submit-message" | "regenerate-message";
export function buildChatRequestBody(input: {
  conversationId: string;
  trigger: ChatTrigger;
  messageId: string | undefined;
  text: string;                      // last user message's text ("" for regenerate)
  parentIdOf: (messageId: string) => string | null | undefined; // meta lookup
}): Record<string, unknown> {
  if (input.trigger === "regenerate-message" && input.messageId) {
    return { conversationId: input.conversationId, regenerateOf: input.messageId };
  }
  if (input.messageId !== undefined) {
    // An edit: the replacement message reuses the edited message's parent.
    const parentId = input.parentIdOf(input.messageId);
    return { conversationId: input.conversationId, text: input.text, ...(parentId !== undefined ? { parentId } : {}) };
  }
  return { conversationId: input.conversationId, text: input.text };
}
```

Unit-test the three shapes (plain send / edit with parent / edit at root parentId null / regenerate).

- [ ] **Step 2: Wire the transport**

`prepareSendMessagesRequest` receives `{ messages, trigger, messageId }` (ai-sdk v6 — recon §4). Replace the current body build with `buildChatRequestBody`, `parentIdOf: (id) => metaById.get(id)?.parentId`. Destructure `stop` and `regenerate` from `useChat`.

- [ ] **Step 3: Edit flow**

On a client message's action row (persisted only — `meta` present), an "Edit" action swaps the bubble for `MessageEdit` (textarea prefilled with the current text, Save/Cancel, `isComposeSubmit` + `composeSubmitTitle("save", isMac)`, maxLength 8000, Save disabled while `isBusy`). Save calls `sendMessage({ text, messageId: m.id })` — the SDK replaces the message locally and triggers a send whose `messageId` flows to the transport (recon: `sendMessage` "If a messageId is provided, the message will be replaced"). **Verify locally that the SDK also truncates trailing messages in its state; if it does not, call `setMessages((ms) => ms.slice(0, ms.findIndex((x) => x.id === m.id) + 1))` immediately before `sendMessage` and re-verify.** Re-syncing server truth (ids, version counts) is not a bare post-settle `router.refresh()`: a `pendingRefresh` ref — armed by edit/regenerate/stop AND by a plain send's clean finish — drives a server-truth adoption effect (`src/lib/adopt-server-messages.ts`: `shouldAdoptServerMessages` + `isAtRest`, sticky-`"error"` aware) that re-seeds the on-screen thread from the server's active path once the chat comes to rest.

- [ ] **Step 4: Regenerate + Stop**

- Regenerate action on AI messages (persisted): `regenerate({ messageId: m.id })`; on settle `router.refresh()`.
- Stop: while `isBusy`, the send button becomes a stop control — same geometry, `aria-label="Stop generating"`, square-in-circle glyph, `onClick={() => stop()}`; after stop, `router.refresh()` (the persisted partial gains meta/actions on reload). Plain send stays `disabled` only when the draft is empty now — busy no longer disables the button, it repurposes it.

- [ ] **Step 5: Gates**

`bunx tsc --noEmit`, `bun run lint`, `bun run build`, `bun run test` (helper tests + nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/chat-screen.tsx src/components/chat/message-edit.tsx src/lib/chat-request.ts src/lib/chat-request.test.ts
git commit  # ✨ Edit, regenerate, and stop — the composer's full vocabulary
```

---

### Task 7: Client chat — version switcher, copy, projected review line (server-driven UI)

**Files:**
- Create: `src/components/chat/version-switcher.tsx`, `src/components/chat/message-copy.tsx`
- Modify: `src/app/chat/[conversationId]/page.tsx` (tree props + projected marker), `src/components/chat/chat-screen.tsx` (mount actions/switcher; prop types)

**Interfaces:**
- Consumes: `loadMessageTree`, `resolveActivePath`, `versionInfo`, `projectMarkerOntoPath` (Task 2); `POST /api/conversations/[id]/active-leaf` (Task 4).
- Produces: page props — `initialMessages` = ACTIVE PATH rows `{ id, sender, text, authorName?, flaggedAt?, parentId }`; `versions: Record<messageId, { index: number; count: number; siblings: string[] }>` (branched path messages only); `reviewMarker.lastReviewedMessageId` = the PROJECTED id for the current path.
- `VersionSwitcher({ messageId, index, count, siblings, conversationId })` — `‹ n/m ›` control; prev/next POSTs `active-leaf` with the neighboring sibling id, then `router.refresh()`; buttons disabled at the ends and while posting; `aria-label`s "Previous version" / "Next version"; visible on hover/focus like the other quiet actions but ALWAYS visible when `count > 1` on the message row (versions must be discoverable, not hover-gated).
- `MessageCopy({ text })` — clipboard write via `navigator.clipboard.writeText`; idle "Copy" (hover-revealed, `message-keep.tsx` idiom verbatim), success flips to "Copied" for 1.5s with an sr-only `role="status"` announcement; failure shows the calm error line. Mounts on client AND AI messages next to `MessageKeep`.

- [ ] **Step 1: Page assembly** — replace `loadMessages` with `loadMessageTree`; `pathIds = resolveActivePath(...)`; `initialMessages` = path rows in order; `versions` from `versionInfo`; `projectMarkerOntoPath` for the divider id. Type the new `ChatScreen` props accordingly.
- [ ] **Step 2: Mounts** — in the message loop: `MessageCopy` beside `MessageKeep` (both senders); `VersionSwitcher` under any message with a `versions` entry (both senders — an edited client message and a regenerated AI message both carry it); Edit (Task 6) sits with the client action row; Regenerate with the AI action row. Keep `MessageFlag` exactly as-is.
- [ ] **Step 3: Gates** — tsc/lint/build + full unit suite. Visual behavior lands in Task 12 e2e + human validation.
- [ ] **Step 4: Commit**

```bash
git add src/components/chat src/app/chat
git commit  # ✨ Version arrows, copy, and a review line that follows the path you're on
```

---

### Task 8: Hide UI — menus, Hidden sections, restore, direct-nav chip

**Files:**
- Modify: `src/components/chat/conversation-rail.tsx` (menu item + Hidden group), `src/components/home/card-menu.tsx` (menu item), `src/app/chat/page.tsx` + `src/app/chat/[conversationId]/page.tsx` (hidden props / direct-nav state), `src/components/chat/chat-screen.tsx` (hidden chip)
- Create: `src/components/chat/hidden-conversations.tsx` (shared collapsed section for rail + home)

**Interfaces:**
- Consumes: `listHiddenConversations` (Task 2), `PATCH { hidden }` (Task 4).
- Copy contracts (exact): menu item **"Hide"**; inline confirm body **"This hides it from your view. If it's shared, your trusted person can still see it. You can restore it any time."** with buttons **"Hide it"** / **"Keep it"**; Hidden section heading **"Hidden"**; restore action **"Restore"**; direct-nav chip **"Hidden — only you can see your own hidden conversations."** with a Restore button.

- [ ] **Step 1: Rail + card menus** — clone the Rename menuitem (recon: conversation-rail.tsx:589-596 / card-menu.tsx:188-195) into "Hide" with the inline confirm swap (End-connection pattern); on confirm PATCH `{ hidden: true }` → `router.refresh()`; per-row busy/error state matching `renameError`'s idiom.
- [ ] **Step 2: Hidden section** — `HiddenConversations({ conversations })`: a `FolderGroup`-style collapsed disclosure (default collapsed) rendered at the rail bottom (above the `mt-auto` block) and on home below `FolderChips`; each row shows title + `relativeTime(hiddenAt)` + "Restore" (PATCH `{ hidden: false }` → refresh); empty ⇒ render nothing at all (no empty shell). Pages fetch via `listHiddenConversations` in their existing `Promise.all`s.
- [ ] **Step 3: Direct navigation** — the conversation page loads even when hidden (it already does — `loadMessages` doesn't check `hiddenAt`; verify and pin with a unit test on `requireOwnedConversation` usage); pass `hidden: boolean` to `ChatScreen`; render the chip + Restore beneath the header when hidden.
- [ ] **Step 4: Gates + commit**

```bash
git add src/components/chat src/components/home src/app/chat
git commit  # ✨ Hide a conversation from your view — and change your mind any time
```

---

### Task 9: Therapist reading view — version navigation + focus-from-queue

**Files:**
- Modify: `src/components/therapist/reading-view.tsx`, `src/app/therapist/conversations/[conversationId]/page.tsx`
- Reuse: `src/components/chat/version-switcher.tsx`? NO — the therapist switcher is VIEW-LOCAL (no POST); create `src/components/therapist/reading-version-switcher.tsx` (presentational: `{ index, count, onPrev, onNext }`) and keep the client one server-driven. Shared look, different contract — do not force one component.

**Interfaces:**
- Consumes: Task 5's `getReadingView` (whole tree + `activeLeafId` + raw marker), `message-tree` pure helpers (client-importable), `?focus=` from the attention queue.
- Behavior: view state `viewLeafId` (default = client's `activeLeafId`); displayed messages = `resolveActivePath(allNodes, viewLeafId)` mapped over the full decrypted set; `versionInfo` for the displayed path; prev/next set `viewLeafId = deepestDescendant(sibling)` LOCALLY (no network, no client-leaf mutation); the review divider renders after `projectMarkerOntoPath(nodes, displayedPathIds, markerMessageId)`; "Mark read to here" keeps PUTting the clicked message's id (any branch — Task 5 allows it); crisis navigator + digest anchors: if the target id is off the displayed path, first `setViewLeafId(deepestDescendant(targetId))`, then `landOn(targetId)` after the path re-renders (`requestAnimationFrame` or effect keyed on viewLeafId); `?focus=<messageId>` on mount does exactly that navigate-and-land.

- [ ] **Step 1: Implement** per above; page passes the whole tree + `activeLeafId` + `searchParams.focus` (validated uuid or ignored).
- [ ] **Step 2: Gates** — tsc/lint/build; behavior in Task 12 e2e.
- [ ] **Step 3: Commit**

```bash
git add src/components/therapist src/app/therapist
git commit  # ✨ The reading view walks every version and lands on what needs attention
```

---

### Task 10: Public landing page

**Files:**
- Modify: `src/app/page.tsx` (redirect signed-in → /chat; render landing signed-out)
- Create: `src/components/landing/landing-page.tsx` (+ small section components in `src/components/landing/` as the design needs)

**Interfaces:**
- Consumes: design tokens/idioms verbatim from recon (serif hero scale up from the desk's `text-[2.3rem]`, `ambient-room`, `animate-message-rise`, accent button idiom, `.cp-panel`); auth state via `auth.api.getSession`.
- Produces: the FAQ copy list as a typed export `export const LANDING_FAQ: { question: string; answer: string }[]` (Task 11's JSON-LD mirrors it 1:1).

- [ ] **Step 1: Invoke the frontend-design skill** (implementer does this — it is the standing directive for UI work) and build: hero ("A private place to talk about how you feel" territory — final line per design skill, claims-honest); privacy-promise section (encrypted at rest per person; plaintext only in memory during AI inference, no-logging providers only; nothing shared by default; sharing granular + revocable; deletion = crypto-shredding — mirror README wording, do not invent); trusted-person section (review line, human-labeled interventions, the audit trail); 4–6 FAQ items (real answers from the README/specs); CTA → /sign-up. Footer: quiet links to sign-in. NO testimonials, NO invented metrics.
- [ ] **Step 2: Routing** — `src/app/page.tsx`: session ? redirect("/chat") : render `<LandingPage />`. Sign-in/up links from the landing carry no `next` param (default flow).
- [ ] **Step 3: Gates** — tsc/lint/build; landing renders in `bun run build` output as static/dynamic without error.
- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/landing
git commit  # ✨ A public front door: the landing page says honestly what this is
```

---

### Task 11: Favicon + SEO/AEO

**Files:**
- Create: `src/app/icon.svg` (designed mark), regenerate `src/app/favicon.ico`, `src/app/apple-icon.png`, `src/app/opengraph-image.png` (+ `twitter-image.png` alias if distinct), `src/app/robots.ts`, `src/app/sitemap.ts`, `public/llms.txt`, `src/components/landing/json-ld.tsx`
- Modify: `src/app/layout.tsx` (metadataBase, title template, description, openGraph/twitter defaults), `src/app/page.tsx`/landing (page metadata + JSON-LD mount), auth + app pages (noindex)

**Interfaces:**
- Consumes: `LANDING_FAQ` (Task 10).
- Contracts: `metadataBase = new URL("https://tellmewhy.huyakhuyak.productions")`; title template `{ default: "tellmewhy — a private place to talk", template: "%s · tellmewhy" }`; robots — allow `/`, `/sign-in`, `/sign-up`; disallow `/chat`, `/notes`, `/exercises`, `/trust`, `/therapist`, `/link`, `/api`; sitemap lists exactly the three public URLs; every authenticated page gets `robots: { index: false, follow: false }` via layout-level or per-page metadata (route groups: add `export const metadata` where missing); JSON-LD: `Organization` + `WebApplication` (name, url, description, applicationCategory "HealthApplication", offers free) + `FAQPage` generated FROM `LANDING_FAQ`; `public/llms.txt` — a short honest description block (what it is, the privacy model, what it is not: not E2EE during inference, not a crisis service) + canonical URL.

- [ ] **Step 1: Design the mark** — a quiet SVG (speech-bubble/question mark inflection in the app's accent `#5457c4` with dark-mode-safe contrast; flat, no gradients) as `src/app/icon.svg`. Generate raster assets one-off: `bunx @resvg/resvg-cli` (or `bunx sharp-cli`) SVG→PNG at 32/180/512 + 1200×630 OG composition (mark + wordmark + tagline on the app background color), then `bunx png-to-ico` for favicon.ico. Commit the binaries; note the exact commands in a comment atop `robots.ts` is NOT needed — put them in the task report only.
- [ ] **Step 2: Metadata + files** per contracts above. Next file conventions: `icon.svg`/`apple-icon.png`/`opengraph-image.png` in `src/app/` are auto-wired — no manual `<link>` tags.
- [ ] **Step 3: Verify** — `bun run build` then check the built HTML head for landing (OG/twitter/canonical/JSON-LD present) and an app page (noindex); `curl localhost:3000/robots.txt`, `/sitemap.xml`, `/llms.txt` on the dev server. Record outputs.
- [ ] **Step 4: Commit**

```bash
git add src/app public/llms.txt src/components/landing
git commit  # 🔍️ A favicon and honest SEO/AEO: indexed front door, private everything else
```

---

### Task 12: e2e — the branching journeys, hide/restore, copy, stop, landing

**Files:**
- Modify: `playwright.config.ts` (desktop project gains `permissions: ["clipboard-read", "clipboard-write"]`), `e2e/desktop.spec.ts`, `e2e/chat.spec.ts`, `e2e/therapist.spec.ts`
- Create: `e2e/landing.spec.ts` (desktop project testMatch addition)

**Coverage (each its own test unless noted):**
1. **Edit branches (desktop):** send → reply → edit the first message ("Edit" action, textarea, ⌘↵) → new reply streams → `‹ 1/2 ›` visible on the edited message → switch back → the ORIGINAL message + its reply render → switch forward again.
2. **Regenerate (desktop):** regenerate the reply → `‹ 2/2 ›` on the AI message → both versions reachable.
3. **Stop (desktop):** send, click "Stop generating" mid-stream (mock streams with delays — verify the AI_MOCK stream is chunked enough; if it finishes too fast to stop deterministically, add a `MOCK_SLOW` marker to the mock model in `src/lib/ai/models.ts` mirroring the MOCK_CRISIS convention, documented in the report) → a partial reply persists after reload and carries actions.
4. **Copy (desktop):** hover reply → Copy → "Copied" flash → `page.evaluate(() => navigator.clipboard.readText())` equals the message text.
5. **Hide/restore (desktop, template: the rail rename test at desktop.spec.ts:272):** menu → Hide → confirm copy exact → row leaves the rail → Hidden section shows it → Restore → row returns. Home-card variant on mobile (`chat.spec.ts`).
6. **Therapist versions + hide-blindness (therapist.spec.ts, extends the journey):** client edits a shared conversation → therapist reading view shows `‹ ›` and flips to the old version (view-local: client's page unaffected — assert client still sees the new path); client hides the shared conversation → therapist desk STILL lists it and the reading view still 200s; client's own rail no longer shows it.
7. **Review-line projection (therapist.spec.ts):** marker set on a message that ends up off-path after an edit → divider still renders (projected) on the new path.
8. **Landing (landing.spec.ts):** signed-out `/` renders the hero + FAQ; JSON-LD script tags present (`script[type="application/ld+json"]` count ≥ 2); `/robots.txt` disallows `/chat`; a signed-in context on `/` redirects to `/chat`.

- [ ] Run `bun run test:e2e` — all green (expect 25+); retry once to shake parallel contention before diagnosing.
- [ ] Full gates: `bun run test`, `bunx tsc --noEmit`, `bun run lint`, `bun run build`.
- [ ] Commit: `✅ Prove branching, hiding, stopping, copying, and the public front door end to end`

---

## After all tasks

1. Final whole-branch review (fable) over the phase range; ONE fix wave if needed.
2. **Human validates changes** (Chrome, both roles, real OpenRouter).
3. **Run superpowers code review** (post-validation gate).
