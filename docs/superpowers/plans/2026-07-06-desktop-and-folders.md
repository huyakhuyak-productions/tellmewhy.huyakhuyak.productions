# tellmewhy Desktop Layout & Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-chosen desktop experience (Guided-hero home, three-zone conversation frame with reading-optimized center) and user-defined conversation folders with encrypted names.

**Architecture:** Folders are a first-class encrypted entity: a `folders` table (name ciphertext, per-user DEK) plus a nullable `folder_id` FK on `conversations` with `ON DELETE SET NULL` (deleting a folder unsorts, never deletes). All encryption and ownership stay in the repository layer (`src/lib/folders.ts`, extending the `conversations.ts` pattern); routes stay thin. The UI splits by viewport: mobile keeps the shipped conversation screen untouched; `lg+` gets the three-zone frame. The home screen is rebuilt for all viewports (hero composer + folder chips + recent cards) and replaces the list page. Message rendering gains a deterministic passage/bubble rule shared by all viewports.

**Tech Stack:** unchanged — Next.js (App Router) + Bun, Postgres/Drizzle, existing crypto + auth + AI modules, Tailwind twilight-journal tokens, Vitest + Playwright.

**Prerequisite:** `feature/foundation` merged into `develop`; this plan executes on a new branch `feature/desktop-and-folders` cut from `develop`.

## Global Constraints

- **Folder names are encrypted** with the user's DEK via `encryptText`/`decryptText` (`src/lib/crypto/envelope.ts`) — never plaintext in Postgres; tests must prove ciphertext at the row level.
- **Ownership enforced in the repository layer** for folders AND for cross-entity assignment (both the conversation and the target folder must belong to the caller) — `NotFoundError` (from `src/lib/conversations.ts`) on any foreign access; adversarial tests required.
- **No plaintext message text in URLs** — the home→conversation first-message handoff uses `sessionStorage`, never query params (URLs land in browser history and server logs).
- **Passage/bubble rule is deterministic and shared:** `isLongForm(text)` = `text.length > 280` OR ≥ 2 non-empty paragraphs (split on blank lines). Boundary tests required (exactly 280 chars → bubble; 281 → passage; exactly 2 paragraphs → passage).
- **Mobile conversation screen unchanged** (< `lg`): no rails, existing bubbles/composer/crisis treatment stay as shipped — except message rendering, which adopts the passage/bubble rule on all viewports.
- **API route discipline** (match the shipped routes): session check → `await req.json().catch(() => null)` → zod `safeParse` → repo call inside try/catch mapping `NotFoundError` → 404. 401/400/404, never a 500 for bad input.
- **UI tasks:** load `frontend-design`, `make-interfaces-feel-better`, `transitions-dev` skills first (standing user directive). The definitive visual reference is mockup variant 09, archived at `docs/superpowers/specs/assets/2026-07-06-desktop-mockups.html`. `color-mix()` needs a static fallback (Chrome < 111 / Safari < 16.2).
- **Commits:** gitmoji, one behavior per commit, git commands one at a time, long-form flags. TDD for every lib/route task.
- No new packages. Env story unchanged.

---

### Task 0: Branch + archive the design reference

**Files:**
- Create: `docs/superpowers/specs/assets/2026-07-06-desktop-mockups.html` (copied)

- [ ] **Step 1:** Confirm `feature/foundation` is merged and cut the branch:

```bash
git switch develop
```
```bash
git switch --create feature/desktop-and-folders
```

- [ ] **Step 2:** Copy the throwaway mockup into the repo as the durable design reference (the scratchpad is session-temporary):

```bash
mkdir -p docs/superpowers/specs/assets
```
```bash
cp "/private/tmp/claude-501/-Users-mykolasolodukha-ghq-github-com-huyakhuyak-productions-tellmewhy-huyakhuyak-productions/f1b02ba9-13e2-48d7-9a84-7c1b2a781393/scratchpad/desktop-design-options.html" docs/superpowers/specs/assets/2026-07-06-desktop-mockups.html
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/assets/2026-07-06-desktop-mockups.html
```
```bash
git commit --message "🍱 Archive the approved desktop mockups as a design reference

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Folders schema + migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0002_*.sql` (generated)

**Interfaces:**
- Produces: `folders` table (`id`, `userId`, `nameCiphertext`, `createdAt`); `conversations.folderId` nullable uuid FK with `ON DELETE SET NULL`.

- [ ] **Step 1:** Add to `src/db/schema.ts` (above `conversations`):

```typescript
// User-defined conversation folders. Names are topic metadata
// ("relationships", "health") — encrypted like conversation titles.
export const folders = pgTable("folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  nameCiphertext: text("name_ciphertext").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

and inside the `conversations` table definition add:

```typescript
  // null = unsorted. Deleting a folder unsorts its conversations.
  folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
```

- [ ] **Step 2:** Generate + run the migration:

```bash
bun run db:generate
```
```bash
bun run db:migrate
```

Expected: `drizzle/0002_*.sql` creates `folders` and adds `folder_id` with `ON DELETE SET NULL`. Verify: `docker compose exec db psql -U tellmewhy --command '\d conversations'` shows the FK.

- [ ] **Step 3:** Full suite still green (`bun run test`), `bunx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle
```
```bash
git commit --message "🗃️ Add folders and a nullable folder link on conversations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Folders repository (TDD)

**Files:**
- Create: `src/lib/folders.ts`
- Test: `src/lib/folders.test.ts` (integration — Docker Postgres)

**Interfaces:**
- Consumes: `db`, `folders`/`conversations` tables, `encryptText`/`decryptText`, `getOrCreateUserDek`, `NotFoundError` from `@/lib/conversations`.
- Produces:
  - `createFolder(userId: string, name: string): Promise<{ id: string }>`
  - `listFolders(userId: string): Promise<{ id: string; name: string; createdAt: Date }[]>` (created-order)
  - `renameFolder(folderId: string, userId: string, name: string): Promise<void>`
  - `deleteFolder(folderId: string, userId: string): Promise<void>` (FK unsorts its conversations)
  - `assignConversationToFolder(conversationId: string, userId: string, folderId: string | null): Promise<void>` (ownership of BOTH entities)

- [ ] **Step 1: Write the failing tests**

`src/lib/folders.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  assignConversationToFolder,
  createFolder,
  deleteFolder,
  listFolders,
  renameFolder,
} from "./folders";
import { NotFoundError, createConversation, listConversations } from "./conversations";
import { db } from "@/db";
import { conversations, folders } from "@/db/schema";

describe("encrypted folders", () => {
  let userId: string;
  beforeEach(() => {
    userId = `test-${randomUUID()}`;
  });

  it("stores folder names as ciphertext only", async () => {
    const { id } = await createFolder(userId, "relationships");
    const [row] = await db.select().from(folders).where(eq(folders.id, id));
    expect(row.nameCiphertext).not.toContain("relationships");
    expect(row.nameCiphertext).toMatch(/^v1\./);
  });

  it("round-trips folder names and lists in created order", async () => {
    await createFolder(userId, "family");
    await createFolder(userId, "work / career");
    expect((await listFolders(userId)).map((f) => f.name)).toEqual(["family", "work / career"]);
  });

  it("renames with re-encryption", async () => {
    const { id } = await createFolder(userId, "old");
    await renameFolder(id, userId, "friends");
    expect((await listFolders(userId)).map((f) => f.name)).toEqual(["friends"]);
  });

  it("assigns and unassigns a conversation", async () => {
    const folder = await createFolder(userId, "family");
    const conv = await createConversation(userId, "Sunday call");
    await assignConversationToFolder(conv.id, userId, folder.id);
    let [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.folderId).toBe(folder.id);
    await assignConversationToFolder(conv.id, userId, null);
    [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.folderId).toBeNull();
  });

  it("deleting a folder unsorts its conversations without deleting them", async () => {
    const folder = await createFolder(userId, "family");
    const conv = await createConversation(userId, "Sunday call");
    await assignConversationToFolder(conv.id, userId, folder.id);
    await deleteFolder(folder.id, userId);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row).toBeDefined();
    expect(row.folderId).toBeNull();
  });

  it("refuses every foreign-access path", async () => {
    const folder = await createFolder(userId, "private");
    const conv = await createConversation(userId, "mine");
    const stranger = `test-${randomUUID()}`;
    await expect(renameFolder(folder.id, stranger, "x")).rejects.toThrow(NotFoundError);
    await expect(deleteFolder(folder.id, stranger)).rejects.toThrow(NotFoundError);
    // stranger's conversation can't be filed into my folder…
    const strangersConv = await createConversation(stranger, "theirs");
    await expect(assignConversationToFolder(strangersConv.id, userId, folder.id)).rejects.toThrow(NotFoundError);
    // …and my conversation can't be filed into a folder I don't own.
    const strangersFolder = await createFolder(stranger, "theirs");
    await expect(assignConversationToFolder(conv.id, userId, strangersFolder.id)).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2:** RED: `bun run test src/lib/folders.test.ts` — module not found.

- [ ] **Step 3: Implement**

`src/lib/folders.ts`:

```typescript
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, folders } from "@/db/schema";
import { decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./conversations";

async function requireOwnedFolder(folderId: string, userId: string) {
  const [row] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
  if (!row) throw new NotFoundError("Folder not found");
  return row;
}

export async function createFolder(userId: string, name: string): Promise<{ id: string }> {
  const dek = await getOrCreateUserDek(userId);
  const [row] = await db
    .insert(folders)
    .values({ userId, nameCiphertext: encryptText(dek, name) })
    .returning({ id: folders.id });
  return row;
}

export async function listFolders(userId: string) {
  const dek = await getOrCreateUserDek(userId);
  const rows = await db.select().from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.createdAt));
  return rows.map((r) => ({ id: r.id, name: decryptText(dek, r.nameCiphertext), createdAt: r.createdAt }));
}

export async function renameFolder(folderId: string, userId: string, name: string): Promise<void> {
  await requireOwnedFolder(folderId, userId);
  const dek = await getOrCreateUserDek(userId);
  await db.update(folders).set({ nameCiphertext: encryptText(dek, name) }).where(eq(folders.id, folderId));
}

export async function deleteFolder(folderId: string, userId: string): Promise<void> {
  await requireOwnedFolder(folderId, userId);
  await db.delete(folders).where(eq(folders.id, folderId)); // FK ON DELETE SET NULL unsorts
}

export async function assignConversationToFolder(
  conversationId: string,
  userId: string,
  folderId: string | null,
): Promise<void> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
  if (!conv) throw new NotFoundError("Conversation not found");
  if (folderId !== null) await requireOwnedFolder(folderId, userId);
  await db.update(conversations).set({ folderId }).where(eq(conversations.id, conversationId));
}
```

- [ ] **Step 4:** GREEN: 6/6, then full suite. `bunx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/folders.ts src/lib/folders.test.ts
```
```bash
git commit --message "✨ Organize conversations into encrypted, user-owned folders

Assignment checks ownership of both the conversation and the
target folder; deleting a folder unsorts, never deletes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Expose folderId on the conversations list (TDD)

**Files:**
- Modify: `src/lib/conversations.ts` (`listConversations` return shape)
- Test: `src/lib/conversations.test.ts` (extend)

**Interfaces:**
- Produces: `listConversations` items gain `folderId: string | null`. (Callers in Task 6/7 group/filter with it.)

- [ ] **Step 1:** Add to the existing describe block in `src/lib/conversations.test.ts`:

```typescript
  it("includes the folder assignment in the list", async () => {
    const { createFolder, assignConversationToFolder } = await import("./folders");
    const folder = await createFolder(userId, "work / career");
    const a = await createConversation(userId, "Deadline spiral");
    await createConversation(userId, "Unsorted one");
    await assignConversationToFolder(a.id, userId, folder.id);
    const list = await listConversations(userId);
    expect(list.find((c) => c.id === a.id)?.folderId).toBe(folder.id);
    expect(list.find((c) => c.title === "Unsorted one")?.folderId).toBeNull();
  });
```

- [ ] **Step 2:** RED (property missing / undefined). **Step 3:** In `listConversations`, add `folderId: r.folderId` to the mapped return object. **Step 4:** GREEN + full suite + tsc.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversations.ts src/lib/conversations.test.ts
```
```bash
git commit --message "✨ Report each conversation's folder in the list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Folder + assignment API routes (TDD)

**Files:**
- Create: `src/app/api/folders/route.ts`, `src/app/api/folders/[folderId]/route.ts`, `src/app/api/conversations/[conversationId]/route.ts`
- Test: `src/app/api/folders/route.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/folders` → `[{ id, name, createdAt }]`; `POST /api/folders` `{ name: 1..80 }` → 201 `{ id }`
  - `PATCH /api/folders/[folderId]` `{ name: 1..80 }` → 204; `DELETE /api/folders/[folderId]` → 204
  - `PATCH /api/conversations/[conversationId]` `{ folderId: uuid | null }` → 204
  - All: 401 no session, 400 invalid/malformed body, 404 foreign (NotFoundError). Follow the shipped route pattern exactly (see `src/app/api/conversations/route.ts` + `src/app/api/chat/route.ts` for the `req.json().catch(() => null)` and error-mapping idioms).

- [ ] **Step 1: Write the failing tests**

`src/app/api/folders/route.test.ts` (mirror the auth/headers mocking pattern from `src/app/api/chat/route.test.ts` verbatim — `vi.mock("@/lib/auth")` returning a fixed `userId`, `vi.mock("next/headers")`):

```typescript
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const userId = `test-${randomUUID()}`;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: userId } })) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET, POST } from "./route";
import { PATCH as PATCH_FOLDER, DELETE as DELETE_FOLDER } from "./[folderId]/route";
import { PATCH as PATCH_CONV } from "../conversations/[conversationId]/route";
import { createConversation } from "@/lib/conversations";
import { createFolder, listFolders } from "@/lib/folders";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/folders", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("folder routes", () => {
  it("creates and lists folders", async () => {
    const res = await POST(jsonRequest("POST", { name: "family" }));
    expect(res.status).toBe(201);
    const list = await (await GET()).json();
    expect(list.map((f: { name: string }) => f.name)).toContain("family");
  });

  it("renames and deletes through the id route", async () => {
    const { id } = await createFolder(userId, "temp");
    const params = Promise.resolve({ folderId: id });
    const rename = await PATCH_FOLDER(jsonRequest("PATCH", { name: "kept" }), { params });
    expect(rename.status).toBe(204);
    const del = await DELETE_FOLDER(new Request("http://localhost", { method: "DELETE" }), { params });
    expect(del.status).toBe(204);
    expect((await listFolders(userId)).map((f) => f.name)).not.toContain("kept");
  });

  it("assigns a conversation to a folder and back to unsorted", async () => {
    const folder = await createFolder(userId, "work / career");
    const conv = await createConversation(userId, "standup dread");
    const params = Promise.resolve({ conversationId: conv.id });
    expect((await PATCH_CONV(jsonRequest("PATCH", { folderId: folder.id }), { params })).status).toBe(204);
    expect((await PATCH_CONV(jsonRequest("PATCH", { folderId: null }), { params })).status).toBe(204);
  });

  it("404s on a foreign folder and 400s on malformed input", async () => {
    const foreign = await createFolder(`test-${randomUUID()}`, "not yours");
    const params = Promise.resolve({ folderId: foreign.id });
    expect((await PATCH_FOLDER(jsonRequest("PATCH", { name: "x" }), { params })).status).toBe(404);
    const bad = new Request("http://localhost/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect((await POST(bad)).status).toBe(400);
  });
});
```

- [ ] **Step 2:** RED (modules not found).

- [ ] **Step 3: Implement the three route files**

`src/app/api/folders/route.ts`:

```typescript
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createFolder, listFolders } from "@/lib/folders";

const createSchema = z.object({ name: z.string().min(1).max(80) });

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await listFolders(session.user.id));
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const folder = await createFolder(session.user.id, parsed.data.name);
  return Response.json(folder, { status: 201 });
}
```

`src/app/api/folders/[folderId]/route.ts`:

```typescript
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/conversations";
import { deleteFolder, renameFolder } from "@/lib/folders";

const renameSchema = z.object({ name: z.string().min(1).max(80) });
const paramsSchema = z.object({ folderId: z.uuid() });

type Ctx = { params: Promise<{ folderId: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  const body = renameSchema.safeParse(await req.json().catch(() => null));
  if (!params.success || !body.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  try {
    await renameFolder(params.data.folderId, session.user.id, body.data.name);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  try {
    await deleteFolder(params.data.folderId, session.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
```

`src/app/api/conversations/[conversationId]/route.ts`:

```typescript
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/conversations";
import { assignConversationToFolder } from "@/lib/folders";

const bodySchema = z.object({ folderId: z.uuid().nullable() });
const paramsSchema = z.object({ conversationId: z.uuid() });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = paramsSchema.safeParse(await ctx.params);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!params.success || !body.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  try {
    await assignConversationToFolder(params.data.conversationId, session.user.id, body.data.folderId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
```

- [ ] **Step 4:** GREEN: 4/4; full suite; tsc; lint.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/folders src/app/api/conversations/[conversationId]
```
```bash
git commit --message "✨ Manage folders and file conversations over the API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Passage/bubble rule (TDD, pure function)

**Files:**
- Create: `src/lib/message-form.ts` (client-safe, no server imports)
- Test: `src/lib/message-form.test.ts`

**Interfaces:**
- Produces: `isLongForm(text: string): boolean` — Task 7's `MessageBubble` switches rendering on it.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { isLongForm } from "./message-form";

describe("isLongForm", () => {
  it("keeps short single-paragraph text as a bubble", () => {
    expect(isLongForm("I had a hard day.")).toBe(false);
  });
  it("treats exactly 280 chars as a bubble and 281 as a passage", () => {
    expect(isLongForm("a".repeat(280))).toBe(false);
    expect(isLongForm("a".repeat(281))).toBe(true);
  });
  it("treats two paragraphs as a passage regardless of length", () => {
    expect(isLongForm("First thought.\n\nSecond thought.")).toBe(true);
  });
  it("ignores blank-only paragraphs", () => {
    expect(isLongForm("One thought.\n\n   \n\n")).toBe(false);
  });
});
```

- [ ] **Step 2:** RED. **Step 3: Implement**

```typescript
// Deterministic long-form rule shared by every viewport: long messages
// render as passages/panels instead of bubbles. Thresholds are a product
// decision (spec 2026-07-06) — change them there first.
const LONG_FORM_CHAR_THRESHOLD = 280;

export function isLongForm(text: string): boolean {
  if (text.length > LONG_FORM_CHAR_THRESHOLD) return true;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return paragraphs.length >= 2;
}
```

- [ ] **Step 4:** GREEN + full suite. **Step 5: Commit**

```bash
git add src/lib/message-form.ts src/lib/message-form.test.ts
```
```bash
git commit --message "✨ Decide bubble versus passage rendering deterministically

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Home screen — Guided hero, folder chips, recent cards (all viewports)

> **REQUIRED before starting:** load `frontend-design`, `make-interfaces-feel-better`, `transitions-dev` skills. Open the archived mockup (`docs/superpowers/specs/assets/2026-07-06-desktop-mockups.html`, variant 09, screen 09a) — it is the definitive look. Mobile is the same composition in a single column.

**Files:**
- Rewrite: `src/app/chat/page.tsx` (server component: session, `listConversations`, `listFolders`, stats not needed here)
- Create: `src/components/home/hero-composer.tsx`, `src/components/home/recent-card.tsx`, `src/components/home/folder-chips.tsx`
- Delete: `src/components/chat/new-conversation-button.tsx` (behavior replaced by the hero; remove fully — no dead code)
- Modify: `e2e/chat.spec.ts` (flow changes: hero replaces the "New conversation" button)

**Interfaces:**
- Consumes: `POST /api/conversations` (`{title}` → `{id}`), sessionStorage draft handoff read by Task 7's ChatScreen.
- Produces: the draft handoff contract — `sessionStorage.setItem("tellmewhy:draft:" + conversationId, text)` then `router.push("/chat/" + conversationId)`. **This exact key format is consumed in Task 7.**

- [ ] **Step 1:** `HeroComposer` (client): underline-only input per spec — serif ~19px italic placeholder ("What's weighing on you today?" — keep the shipped app's voice), 1.5px baseline rule, quiet send arrow at the rule's end, focus warms the rule to accent via hairline thickening (no glow, no layout shift). Submit handler:

```tsx
async function submit(e: React.FormEvent) {
  e.preventDefault();
  const text = draft.trim();
  if (!text || pending) return;
  setPending(true);
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" }) }),
  });
  setPending(false);
  if (!res.ok) return setError("Couldn't start the conversation — try again.");
  const { id } = await res.json();
  // Never put message text in the URL — history and logs. Task 7 reads+clears this key.
  sessionStorage.setItem(`tellmewhy:draft:${id}`, text);
  router.push(`/chat/${id}`);
}
```

(Show the error inline under the rule, `role="alert"` — no silent failure, no double-create: keep `pending` true until navigation or error.)

- [ ] **Step 2:** `FolderChips` (client): centered row — `All` plus one chip per folder (names from the server component via props); selecting filters the cards client-side (`folderId` match; `All` shows everything). Quiet text chips, active chip gently lit. Skip rendering the row entirely when the user has no folders.

- [ ] **Step 3:** `RecentCard`: title, quiet folder tag (name or nothing when unsorted), relative time; links to `/chat/[id]`. Server page renders the hero, chips, and up to 6 most-recent cards; empty state keeps the shipped copy ("This space is yours. Start whenever you're ready.").

- [ ] **Step 4:** Update `e2e/chat.spec.ts`: replace the "New conversation" click in both scenarios with: fill the hero input (give it `aria-label="Start a conversation"`), press Enter (or click the send arrow, `aria-label="Send"` — pick one and match the markup), then expect `/chat/<uuid>` URL and the first message + streamed reply visible (the draft handoff means the message sends on arrival — this exercises Task 7's mount-send too; if Task 7 isn't merged yet in your worktree, the message won't auto-send: in that case assert only navigation here and extend the assertion in Task 7).

- [ ] **Step 5:** Verify: tsc, lint, unit suite; manual dev-server drive at 390px and 1440px, both themes.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat/page.tsx src/components/home src/components/chat e2e/chat.spec.ts
```
```bash
git commit --message "✨ Open onto an invitation to talk, not a list

The home screen becomes the Guided hero: an underline composer
that starts the conversation with your first sentence, folder
filter chips, and pick-up-where-you-left-off cards.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Conversation screen — three-zone desktop frame + passage rendering

> **REQUIRED before starting:** design skills + archived mockup screen 09b. Mobile (< `lg`) layout stays exactly as shipped: single column, no rails. `color-mix()` usages need a plain-color fallback line above them.

**Files:**
- Modify: `src/app/chat/[conversationId]/page.tsx` (fetch rails data: `listConversations`, `listFolders`, stats derived from the list; pass to layout)
- Create: `src/components/chat/conversation-rail.tsx` (left), `src/components/chat/stats-rail.tsx` (right)
- Modify: `src/components/chat/chat-screen.tsx` (three-zone grid on `lg+`; center column ~760px measure; draft auto-send on mount; docked crisis card on `lg+`)
- Modify: `src/components/chat/message-bubble.tsx` (passage/bubble split via `isLongForm`)

**Interfaces:**
- Consumes: `listConversations` (now with `folderId`), `listFolders`, `isLongForm`, the Task 6 sessionStorage draft contract, `PATCH /api/conversations/[id]` + `POST /api/folders` for assignment/creation from the rail.

- [ ] **Step 1:** Server page: fetch `[messages, conversationList, folderList]` with `Promise.all` (after the ownership-checked `loadMessages` — keep the ownership check first and separate so a foreign id still 404s before any other work). Derive stats in the page: `total = conversationList.length`, `thisWeek = list.filter(updatedAt within 7 days).length`, member-since from `session.user.createdAt`. Pass everything to `ChatScreen`.

- [ ] **Step 2:** `ConversationRail` (client): folder-grouped list — small-caps collapsible headings (chevron; collapsed state local `useState`), conversations beneath, "unsorted" group last, whisper-quiet "+ New folder" at the foot (inline input on click → `POST /api/folders` → `router.refresh()`). Each conversation row: title + relative time, current one marked; a small overflow menu ("Move to…" listing folders + Unsorted → `PATCH /api/conversations/[id]`, then `router.refresh()`). Receded character: no fills, muted type, faded borders (`color-mix` with fallback).

- [ ] **Step 3:** `StatsRail`: real stats (conversations this week, total, member since) rendered quietly, then tasteful placeholder slots labeled for phase 2/3 (therapist review, mood trend, notes) — visibly placeholders, not fake data.

- [ ] **Step 4:** `ChatScreen`: on `lg+`, a three-zone grid (`lg:grid lg:grid-cols-[260px_minmax(0,1fr)_280px]`; rails `hidden lg:block`); center column max-width ~760px with generous line-height. Draft auto-send on mount:

```tsx
const sentDraft = useRef(false);
useEffect(() => {
  if (sentDraft.current) return;
  const key = `tellmewhy:draft:${conversationId}`;
  const draft = sessionStorage.getItem(key);
  if (draft) {
    sessionStorage.removeItem(key);
    sentDraft.current = true;
    sendMessage({ text: draft });
  }
}, [conversationId, sendMessage]);
```

Crisis banner: on `lg+` render as a width-capped card docked above the composer within the center column (not fixed-overlay); keep the shipped fixed-overlay on mobile. Same `role="alertdialog"`/`aria-label`/copy — the e2e contract strings must not change.

- [ ] **Step 5:** `MessageBubble`: keep the current rendering for short messages; when `isLongForm(text)`:
  - assistant → serif passage: no bubble background, left accent rule (2px), small muted sender label ("companion"), full-measure text via `Streamdown`;
  - user → gently tinted panel (accent at low alpha) with **body-colored text** (NOT `--accent-foreground`), rounded, comfortable padding. Verify AA contrast in both themes (check computed contrast against the tint).

- [ ] **Step 6:** Verify: tsc, lint, full unit suite; extend the Task 6 e2e assertion if it was deferred (hero → arrival → auto-sent message streams). Manual drive: long multi-paragraph messages render as passage/panel at both 390px and 1440px; rails only at `lg+`; folder create/move from the rail works.

- [ ] **Step 7: Commit**

```bash
git add src/app/chat src/components/chat
```
```bash
git commit --message "✨ Give desktop a three-zone frame that keeps the conversation first

Folder-grouped rail left, quiet stats right, and a reading-
optimized center where long reflections render as passages
instead of bubbles.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Desktop e2e + docs

**Files:**
- Modify: `playwright.config.ts` (desktop project), `README.md` (folders + desktop one-liners)
- Create: `e2e/desktop.spec.ts`

- [ ] **Step 1:** Add a desktop project and scope specs per project:

```typescript
projects: [
  { name: "mobile", use: { ...devices["iPhone 14"], browserName: "chromium" }, testMatch: /chat\.spec\.ts/ },
  { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /desktop\.spec\.ts/ },
],
```

- [ ] **Step 2:** `e2e/desktop.spec.ts` — one signup helper (copy from chat.spec.ts), two tests:

```typescript
test("hero starts a conversation and the reply streams in the three-zone frame", async ({ page }) => {
  await signUp(page);
  await page.getByLabel("Start a conversation").fill("I keep replaying a conversation from work");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  await expect(page.getByText("I keep replaying a conversation from work")).toBeVisible();
  await expect(page.locator('[data-streamdown="strong"]', { hasText: "mock reply" })).toBeVisible();
  await expect(page.getByText(/conversations/i).first()).toBeVisible(); // left rail present at 1440px
});

test("folders group the rail and filter the home cards", async ({ page }) => {
  await signUp(page);
  // create a conversation via the hero, then a folder from the rail, move the chat into it
  await page.getByLabel("Start a conversation").fill("Family stuff on my mind");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  await page.getByRole("button", { name: /new folder/i }).click();
  await page.getByPlaceholder(/folder name/i).fill("family");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /move to/i }).click();
  await page.getByRole("menuitem", { name: "family" }).click();
  await expect(page.getByRole("heading", { name: /family/i })).toBeVisible(); // rail group heading
  await page.goto("/chat");
  await expect(page.getByRole("button", { name: "family" })).toBeVisible(); // filter chip
});
```

(Adjust selectors to Task 6/7's real markup — behavior under test, not styling; keep role/label queries.)

- [ ] **Step 3:** Run `bun run test:e2e` — all projects green (2 mobile + 2 desktop). Full unit suite + tsc + lint + `bun run build` all green.

- [ ] **Step 4:** README: add folders to the feature paragraph and a "Desktop" sentence (three-zone frame, hero home). No privacy-copy changes needed (folder encryption is covered by the existing "conversation titles" language — extend that sentence to "titles and folder names").

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e/desktop.spec.ts README.md
```
```bash
git commit --message "✅ Cover the desktop hero, rails, and folder flows end-to-end

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification (whole sub-project)

1. `bun run test` — prior 37 + new (folders 6, list 1, routes 4, message-form 4) all green.
2. `bun run test:e2e` — mobile 2 + desktop 2.
3. Ciphertext check: `docker compose exec db psql -U tellmewhy --command "select name_ciphertext from folders limit 3;"` → `v1.…` blobs only.
4. Manual: 1440px + 390px, both themes; long-message passage rendering; folder create/move/delete (delete unsorts); crisis flow unchanged on mobile, docked card on desktop.
5. `bun run build` green.
6. Human validation, then superpowers code review (mandatory task-list tail).
