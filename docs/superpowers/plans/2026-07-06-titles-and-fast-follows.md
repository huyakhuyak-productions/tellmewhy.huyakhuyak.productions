# tellmewhy Titles & Fast-Follows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conversation titles that name themselves (auto-generated after the first reply) and can be renamed anywhere — plus the accumulated hardening/quality/a11y backlog both prior reviews agreed to fast-follow.

**Architecture:** Titles stay encrypted ciphertext; a new `title_customized` boolean marks human-chosen titles so auto-titling can never overwrite them. Auto-titling runs fire-and-forget inside the chat route's existing `onFinish` (first exchange only), using a dedicated cheap title model behind `getTitleModel()` (mocked under `AI_MOCK`). Manual rename extends the existing `PATCH /api/conversations/[id]` route and surfaces in the rail menu (desktop) and a new home-card overflow menu (all viewports — which also finally brings folder-move to mobile). The hardening/quality/a11y tasks are grouped into three sweeps with named findings from the review ledger.

**Tech Stack:** unchanged. No new packages (the rate limiter is a small in-memory token bucket — Redis is explicitly out of scope for a single-instance MVP).

**Prerequisite:** executes directly on `main` (single-branch repo). Full suite + tsc + lint green before every commit.

## Global Constraints

- All existing invariants hold: titles/folder names/messages encrypted with the user's DEK; ownership in the repository layer (`NotFoundError` → 404); no plaintext in URLs or logs (log conversationId only); crisis contract strings untouchable; design skills (`frontend-design`, `make-interfaces-feel-better`, `transitions-dev`) loaded before any UI work.
- Auto-title rule: fires ONLY when (a) the conversation has exactly one exchange (the history loaded in the route had length 1 before the reply) AND (b) `title_customized` is false. Manual rename sets `title_customized = true`; auto-title leaves it false.
- Auto-title model: `getTitleModel()` in `src/lib/ai/models.ts` — real path uses `OPENROUTER_CLASSIFIER_MODEL` (cheap tier) with the standard no-logging settings; `AI_MOCK=1` returns a mock generating the literal text `A quiet mock title`.
- Title length: generated titles clamped to 80 chars server-side; manual titles validated 1..200 (matches existing conversations POST).
- TDD for every lib/route task; gitmoji commits, one behavior each; git one command at a time, long-form flags.

---

### Task 1: `title_customized` column

**Files:** Modify `src/db/schema.ts`; generate `drizzle/0004_*.sql` (0003 if none landed since — take the next number drizzle-kit produces).

- [ ] Add inside the `conversations` table definition:

```typescript
  // True once a human renamed the conversation — auto-titling must never overwrite.
  titleCustomized: boolean("title_customized").notNull().default(false),
```

(Import `boolean` from `drizzle-orm/pg-core` alongside the existing imports.)

- [ ] `bun run db:generate` && `bun run db:migrate` — additive only (one ADD COLUMN with default; existing rows get `false`, which is correct: they all have default date titles). Suite 52/52, tsc, lint.
- [ ] Commit:

```bash
git commit --message "🗃️ Track whether a human chose the conversation title

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Rename + title metadata in the repository (TDD)

**Files:** Modify `src/lib/conversations.ts`; extend `src/lib/conversations.test.ts`.

**Interfaces produced:**
- `renameConversation(conversationId: string, userId: string, title: string, opts?: { customized?: boolean }): Promise<void>` — re-encrypts the title; sets `titleCustomized` to `opts.customized ?? true`.
- `isTitleCustomized(conversationId: string, userId: string): Promise<boolean>` — ownership-checked, no decryption.

- [ ] **Failing tests** (append to the existing describe block):

```typescript
  it("renames with re-encryption and marks the title customized", async () => {
    const { id } = await createConversation(userId, "July 6");
    await renameConversation(id, userId, "Replaying a work conversation");
    const list = await listConversations(userId);
    expect(list.find((c) => c.id === id)?.title).toBe("Replaying a work conversation");
    expect(await isTitleCustomized(id, userId)).toBe(true);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    expect(row.titleCiphertext).not.toContain("Replaying");
  });

  it("auto-rename (customized: false) does not claim the title for humans", async () => {
    const { id } = await createConversation(userId, "July 6");
    await renameConversation(id, userId, "A generated title", { customized: false });
    expect(await isTitleCustomized(id, userId)).toBe(false);
  });

  it("refuses foreign rename and metadata reads", async () => {
    const { id } = await createConversation(userId, "Private");
    await expect(renameConversation(id, "someone-else", "x")).rejects.toThrow(NotFoundError);
    await expect(isTitleCustomized(id, "someone-else")).rejects.toThrow(NotFoundError);
  });
```

- [ ] RED → implement:

```typescript
export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string,
  opts?: { customized?: boolean },
): Promise<void> {
  await requireOwnedConversation(conversationId, userId);
  const dek = await getOrCreateUserDek(userId);
  await db
    .update(conversations)
    .set({ titleCiphertext: encryptText(dek, title), titleCustomized: opts?.customized ?? true })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
}

export async function isTitleCustomized(conversationId: string, userId: string): Promise<boolean> {
  const row = await requireOwnedConversation(conversationId, userId);
  return row.titleCustomized;
}
```

(Note the belt-and-braces `and(eq(id), eq(userId))` on the UPDATE — adopt this pattern here even though ownership was already checked; final review asked for it on mutations.)

- [ ] GREEN (file + full suite), tsc, lint. Commit:

```bash
git commit --message "✨ Rename conversations with re-encrypted, human-owned titles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Auto-title after the first reply (TDD)

**Files:** Modify `src/lib/ai/models.ts` (add `getTitleModel()` + mock), `src/lib/ai/system-prompt.ts` (add `buildTitlePrompt`), `src/app/api/chat/route.ts` (onFinish); extend `src/app/api/chat/route.test.ts`, `src/lib/ai/models.test.ts`.

- [ ] `getTitleModel()`: real path `openrouter()(process.env.OPENROUTER_CLASSIFIER_MODEL ?? "google/gemini-2.5-flash-lite", NO_LOGGING)`; mock path a `doGenerate` model returning text `A quiet mock title`. Unit test the mock via `generateText` (mirrors the existing mock tests).
- [ ] `buildTitlePrompt(userText: string, replyText: string): string` — instructs: "3 to 6 plain words naming the emotional topic; no quotes, no punctuation, no names" and includes both texts.
- [ ] Chat route `onFinish` — the history length is already in scope (`history` loaded before streaming; first exchange ⇔ `history.length === 1`). After the existing reply-persist try/catch, add:

```typescript
        if (history.length === 1) {
          try {
            if (!(await isTitleCustomized(conversationId, userId))) {
              const { text: rawTitle } = await generateText({
                model: getTitleModel(),
                prompt: buildTitlePrompt(text, replyText),
                abortSignal: AbortSignal.timeout(5000),
              });
              const title = rawTitle.trim().slice(0, 80);
              if (title) await renameConversation(conversationId, userId, title, { customized: false });
            }
          } catch (error) {
            // Fire-and-forget by design — a failed title never disturbs the chat.
            console.error(`Failed to auto-title conversation ${conversationId}`, error);
          }
        }
```

- [ ] Route tests (mock models are active): first exchange → after draining the stream, `vi.waitFor` until `listConversations` shows title `A quiet mock title` and `isTitleCustomized` is false; second exchange in the same conversation → title unchanged; pre-renamed conversation (`renameConversation(..., "Mine")`) → stays `Mine`.
- [ ] GREEN, full suite, tsc, lint. Commit:

```bash
git commit --message "✨ Name conversations automatically after the first reply

A cheap no-logging model call titles the opening exchange;
human-chosen titles are never overwritten.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Manual rename over the API (TDD)

**Files:** Modify `src/app/api/conversations/[conversationId]/route.ts`; extend `src/app/api/folders/route.test.ts` (it already hosts the PATCH_CONV tests).

- [ ] Body schema becomes:

```typescript
const bodySchema = z
  .object({
    folderId: z.uuid().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
  })
  .refine((b) => b.folderId !== undefined || b.title !== undefined, { message: "Nothing to update" });
```

Handler applies whichever fields are present (`assignConversationToFolder` for folderId, `renameConversation` — customized defaults true — for title); still 204, still NotFoundError → 404; `{}` → 400 (refine).
- [ ] Tests: rename via PATCH reflected in `listConversations` + `isTitleCustomized() === true`; `{}` → 400; foreign id → 404; combined `{title, folderId}` applies both.
- [ ] GREEN, full suite, tsc, lint. Commit:

```bash
git commit --message "✨ Rename conversations over the API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Rename + move UI everywhere (design skills mandatory)

**Files:** Modify `src/components/chat/conversation-rail.tsx` (add "Rename" to the row menu → inline input in place, PATCH, refresh); create `src/components/home/card-menu.tsx` and wire into `src/components/home/recent-card.tsx` (quiet overflow button: Rename inline + "Move to…" folder list — this brings BOTH actions to mobile for the first time); extend `e2e/desktop.spec.ts` (rename via rail menu → new title visible in rail and on home) and `e2e/chat.spec.ts` (mobile: card menu rename → new title visible).

Constraints: role/label-driven markup (menus `role="menu"`/`menuitem`, inputs labeled); errors surfaced `role="alert"` with the Task-fix patterns (try/catch/finally, no silent deaths, no stuck busy states); Escape closes these new menus (and add Escape to the existing move menu while in the file — finding #4's first half); no message/title text in console output.

- [ ] Implement; verify `bun run test:e2e` (all projects green), suite, tsc, lint, `bun run build`; manual drive 390px + 1440px both themes.
- [ ] Commit:

```bash
git commit --message "✨ Rename and file conversations from any screen

The home cards gain an overflow menu, bringing rename and
folder-move to phones where the rail does not exist.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Hardening sweep (TDD where behavior changes)

**Files:** `src/lib/ai/models.ts`, `src/app/api/chat/route.ts`, `src/lib/conversations.ts`, `src/components/home/hero-composer.tsx`, `src/db/schema.ts` + migration, new `src/lib/rate-limit.ts` + test.

Named findings, each its own commit:
- [ ] **AI_MOCK production guard** (`models.ts`): at module scope, `if (process.env.AI_MOCK === "1" && process.env.NODE_ENV === "production") throw new Error("AI_MOCK must not be enabled in production");` — a misconfigured prod must never serve canned empathy. Commit `🦺`.
- [ ] **Rate limit /api/chat** (`rate-limit.ts`): in-memory token bucket per userId — 20 requests/5 min, refill continuously; pure class + unit tests (consume/refill/deny), wired at the top of the chat POST → 429 `{error: "Slow down a little"}` when empty. Document the single-instance limitation in a comment. Commit `🦺`.
- [ ] **Indexes + FKs** (schema + one migration): index `conversations.user_id`, `messages.conversation_id`, `folders.user_id`; add the missing FK `conversations.user_id → user.id` now that table ordering allows it (verify drizzle generates additive DDL only — STOP if it wants drops). Commit `🗃️`.
- [ ] **saveMessage transaction** (`conversations.ts`): wrap the insert + `updatedAt` bump in `db.transaction`; also isolate per-row decrypt failures in `listConversations`/`loadMessages` (skip-and-log row id, never abort the whole list; add a corrupt-row test by writing garbage ciphertext directly). Commit `🥅`.
- [ ] **Hero res.json residual** (`hero-composer.tsx`): move `res.json()` inside the existing try (mid-body connection drop currently strands `pending`). Commit `🩹`.

---

### Task 7: Quality sweep

Each its own commit; suite/tsc/lint after each:
- [ ] `src/lib/errors.ts`: move `NotFoundError` there; `conversations.ts` re-exports for compatibility; `folders.ts` + routes import from the new home. Commit `🏗️`.
- [ ] 401 tests: one per route test file (auth mock returning null session for a single test via `mockResolvedValueOnce(null)`) — chat, conversations, folders, folder-id, conversation-id. Commit `✅`.
- [ ] `z.string().uuid()` → `z.uuid()` in `src/app/api/chat/route.ts` (the one remaining deprecated call). Commit `🚨`.
- [ ] `simulateReadableStream` import from `"ai"` instead of deprecated `"ai/test"` path; consolidate the duplicated v6 mock scaffolding (`models.ts` + `crisis.test.ts` + `models.test.ts` riskSchema) into `src/test/ai-fixtures.ts`. Commit `♻️`.
- [ ] Unit tests for `src/lib/chat-stats.ts` (7-day boundary) and `src/lib/relative-time.ts` (today/weekday/older-year branches). Commit `✅`.
- Accepted debt, do NOT touch: `generateObject` deprecation (functional; migrating to `generateText({output})` is riskier than the debt), React `FormEvent` deprecation hints, bun.lock workspace name.

---

### Task 8: A11y & UX polish sweep (design skills for anything visual)

Each its own commit:
- [ ] Crisis banner focus trap + `aria-modal` handling appropriate to its docked/overlay variants (focus moves in on open, returns on dismiss). Commit `♿️`.
- [ ] Visible `<label>`s (or properly wired sr-only labels) for the auth inputs. Commit `♿️`.
- [ ] Move-to menu: close on scroll (the detach case) — Escape was handled in Task 5. Commit `🚸`.
- [ ] `prefers-reduced-motion` coverage for the remaining hover/active transforms. Commit `♿️`.
- [ ] `middleware.ts` → `proxy.ts` per Next 16 (verify `getSessionCookie` semantics unchanged; e2e still green). Commit `🚚`.
- [ ] Crisis card centering within the chat column (not the viewport) on lg+. Commit `💄`.

---

### Task 9 (user increment, 2026-07-06): live title without reload

**Problem:** the auto-title lands server-side up to ~5s after the stream closes; the rail/home only show it after a manual reload.
**Design (locked):** do NOT hold the response stream open for the title (that would keep the composer disabled). Client-side in `ChatScreen`: when THIS session sent the conversation's first exchange (`initialMessages.length <= 1` and the message count reaches 2) and `status` returns to `"ready"`, start a short watcher — fetch `GET /api/conversations` immediately as a baseline, then poll every 1.5s (max 6 attempts) until this conversation's title differs from the baseline; then call `router.refresh()` ONCE and stop. Cleanup on unmount; no polling on later exchanges; a manual rename mid-poll also changes the title and simply triggers the same single refresh. No new endpoints, no new packages.
**e2e:** desktop spec — after the streamed reply, expect the rail to show "A quiet mock title" WITHOUT `page.reload()` (generous ~12s timeout); mobile spec — client-side navigate home (tap a link, no reload) and expect the card to show the generated title.
**Commit:** `✨ Show the generated title without a reload`

### Task 10 (user increment, 2026-07-06): drag conversations into folders

**Scope (locked):** native HTML5 drag-and-drop, pointer/desktop only (touch keeps the card menu — no DnD library without approval). Two surfaces:
- **Rail (lg+):** conversation rows become `draggable`; folder group headings and the "unsorted" group become drop targets (visible drop-affordance on `dragover` — e.g. the heading warms/outline, consistent with the twilight tokens); drop → `PATCH /api/conversations/[id] {folderId}` → `router.refresh()`; same row-level `role="alert"` error surface as the menu path on failure.
- **Home (lg+ only):** cards draggable onto the folder filter chips (chip highlights on dragover; drop files the conversation and refreshes). Skip if it genuinely fights the chip row's calm — report the judgment call.
The existing menu path stays (keyboard/touch accessibility path — DnD is an enhancement, never the only way).
**e2e:** desktop spec — dragDrop a rail row onto a folder heading (Playwright `dragTo`), assert regrouping; keep menu-path coverage intact.
**Commit:** `✨ Drag conversations into folders on desktop`

---

## Verification (whole plan)

1. Suite green with all new tests; tsc; lint; `bun run build`.
2. e2e all projects green including the new rename scenarios.
3. Manual: first message in a fresh conversation → title appears on home/rail after the reply (real model: a sensible 3–6 word title; AI_MOCK: "A quiet mock title"); rename from a phone-width card menu; rapid-fire 21 chat messages → 429 with a gentle message.
4. Ciphertext spot-check unchanged (`titleCiphertext` still `v1.…` after renames).
5. Human validation → superpowers code review (mandatory task-list tail).
