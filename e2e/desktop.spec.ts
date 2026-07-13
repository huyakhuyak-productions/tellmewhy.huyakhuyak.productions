import { expect, test } from "@playwright/test";

// Shared sign-up flow: create a fresh account and land on the home screen.
async function signUp(page: import("@playwright/test").Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  await page.goto("/sign-up");
  await page.getByPlaceholder("Your name").fill("E2E");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill("longenough-pass");
  await page.getByRole("button", { name: /start talking/i }).click();
  await expect(page).toHaveURL(/\/chat/);
}

test("a mood check-in lights up the rail sparkline", async ({ page }) => {
  await signUp(page);

  // The check-in row rides near the hero on both viewports; tap "Good".
  const good = page.getByRole("button", { name: "Good — 4 of 5" });
  const saved = page.waitForResponse(
    (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/mood",
  );
  await good.click();
  await saved;
  // Optimistic then confirmed: the tapped glyph reads pressed and the live
  // region says today's check-in landed.
  await expect(good).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Checked in — change it any time.")).toBeVisible();

  // The sparkline lives on the desktop rail inside a conversation — start one
  // from the hero, and the freshly saved check-in draws its first point of light.
  await page.getByLabel("Start a conversation").fill("A quiet evening in");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);

  const sparkline = page.getByRole("img", { name: /Mood over the last 8 weeks/ });
  await expect(sparkline).toBeVisible();
  // One check-in now, and a real dot rather than the empty dashed axis.
  await expect(sparkline).toHaveAttribute("aria-label", /1 check-in/);
  await expect(sparkline.locator("circle")).not.toHaveCount(0);
});

test("hero starts a conversation and the reply streams in the three-zone frame", async ({
  page,
}) => {
  await signUp(page);

  await page.getByLabel("Start a conversation").fill("I keep replaying a conversation from work");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/chat\/.+/);
  await expect(page.getByText("I keep replaying a conversation from work")).toBeVisible();
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();
  // Left rail is `hidden lg:flex` — visible at this 1440px viewport, absent on mobile.
  await expect(page.getByText("Conversations", { exact: true })).toBeVisible();
});

test("folders group the rail and filter the home cards", async ({ page }) => {
  await signUp(page);

  // Start a conversation via the hero, then create a folder from the rail and
  // move the fresh (unsorted) conversation into it.
  await page.getByLabel("Start a conversation").fill("Family stuff on my mind");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  // The card title is the hero's date-based conversation title, not the
  // first message — so later assertions key off the conversation's id/url.
  const conversationHref = new URL(page.url()).pathname;

  await page.getByRole("button", { name: /new folder/i }).click();
  await page.getByLabel("New folder name").fill("family");
  await page.keyboard.press("Enter");

  // Wait for the PATCH to actually land — otherwise `page.goto` below can
  // navigate away before the move persists, making the filter assertion flaky.
  const movePersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/conversations/"),
  );
  await page.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "family" }).click();
  await movePersisted;

  // FolderGroup's label is a disclosure <button aria-expanded>, not a heading
  // element — the rail groups conversations under collapsible toggles, so the
  // group appearing is what the test cares about, not its element type.
  await expect(page.getByRole("button", { name: "family", exact: true })).toBeVisible();

  await page.goto("/chat");
  await expect(page.getByRole("button", { name: "family" })).toBeVisible();

  // The home chips must filter the full history, not just the six-card
  // recent slice — selecting the folder should surface the moved card.
  await page.getByRole("button", { name: "family", exact: true }).click();
  await expect(page.locator(`a[href="${conversationHref}"]`)).toBeVisible();
});

test("the generated title appears in the rail without a reload", async ({ page }) => {
  await signUp(page);

  await page.getByLabel("Start a conversation").fill("Thinking about a career change");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const conversationHref = new URL(page.url()).pathname;
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();

  // The auto-title lands async after the stream closes (see route.ts's
  // fire-and-forget classify+rename). ChatScreen polls for it client-side and
  // calls router.refresh() once — no page.reload() here, so this only passes
  // if that watcher (not a manual refresh) is what surfaces the new title.
  await expect(
    page.locator(`a[href="${conversationHref}"]`).getByText("A quiet mock title"),
  ).toBeVisible({ timeout: 12_000 });
});

test("the title watcher survives a router.refresh from an unrelated rename", async ({ page }) => {
  await signUp(page);

  // A second, unrelated conversation that we'll rename mid-poll. Its rename
  // calls router.refresh(), which used to hand ChatScreen a brand-new
  // `conversations` array identity and — because that array was wrongly a
  // dependency of the title-watcher effect — silently kill the poll for the
  // FIRST conversation below (see chat-screen.tsx).
  await page.getByLabel("Start a conversation").fill("A thread to rename elsewhere");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const otherHref = new URL(page.url()).pathname;

  await page.goto("/chat");
  await page.getByLabel("Start a conversation").fill("Weighing a big decision");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const conversationHref = new URL(page.url()).pathname;
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();

  // Rename the OTHER conversation right away — this is the unrelated
  // router.refresh() that must not stop the watcher started above. (The mock
  // title can land before or after this rename resolves — both orders are
  // fine and deliberately not pinned down; the thing under test is that the
  // refresh never kills the outcome, not the exact interleaving.)
  const otherRow = page.locator(`div:has(> a[href="${otherHref}"])`).first();
  await otherRow.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renamePersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/conversations/"),
  );
  const input = page.getByRole("textbox", { name: "Rename conversation" });
  await input.fill("Renamed elsewhere");
  await input.press("Enter");
  await renamePersisted;

  // The generated title for THIS conversation still surfaces without a
  // manual reload, proving the unrelated refresh above didn't cancel the poll.
  await expect(
    page.locator(`a[href="${conversationHref}"]`).getByText("A quiet mock title"),
  ).toBeVisible({ timeout: 12_000 });
});

test("drag a rail conversation onto a folder heading to file it", async ({ page }) => {
  await signUp(page);

  // A fresh (unsorted) conversation plus an empty folder to drop it into.
  await page.getByLabel("Start a conversation").fill("A thought to file away");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const conversationHref = new URL(page.url()).pathname;

  await page.getByRole("button", { name: /new folder/i }).click();
  await page.getByLabel("New folder name").fill("keepsakes");
  await page.keyboard.press("Enter");
  const heading = page.getByRole("button", { name: "keepsakes", exact: true });
  await expect(heading).toBeVisible();

  // The draggable element is the row wrapper around the conversation link.
  const row = page.locator(`div:has(> a[href="${conversationHref}"])`).first();
  await expect(row).toBeVisible();

  const movePersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/conversations/"),
  );
  await row.dragTo(heading);
  await movePersisted;

  // After the drop the conversation regroups under the folder — filtering the
  // home chips by "keepsakes" surfaces the row that was previously unsorted.
  await page.goto("/chat");
  await page.getByRole("button", { name: "keepsakes", exact: true }).click();
  await expect(page.locator(`a[href="${conversationHref}"]`)).toBeVisible();
});

test("keep a reply, find it on the rail and /notes, add one, then let it go", async ({ page }) => {
  await signUp(page);

  // Start a conversation from the hero and let the mock reply stream in.
  await page.getByLabel("Start a conversation").fill("Something worth keeping for later");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const conversationHref = new URL(page.url()).pathname;
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();

  // "Keep this" rides only on persisted messages — a just-streamed reply is
  // still client-only, with no server id. The auto-title landing in the rail is
  // the signal that the reply has been saved (see the title-watcher test);
  // reloading then re-hydrates the transcript from the server, so every message
  // carries its id and gains the affordance.
  await expect(
    page.locator(`a[href="${conversationHref}"]`).getByText("A quiet mock title"),
  ).toBeVisible({ timeout: 12_000 });
  await page.reload();

  // Scope to the AI reply's own group so the person's-message keep button
  // (same aria-label, under their bubble) never collides.
  const replyGroup = page.locator("div.group\\/msg").filter({ hasText: "mock reply" });
  const keep = replyGroup.getByRole("button", { name: "Keep this for your future self" });
  await expect(keep).toBeVisible();

  await replyGroup.hover();
  const kept = page.waitForResponse(
    (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/notes",
  );
  await keep.click();
  await kept;
  // The confirmation now lives in two places under the reply: the always-mounted
  // sr-only live region (role=status) that a screen reader announces, and the
  // visible settled line. Assert the announcement via its role — the plain
  // visible text alone would be a strict-mode duplicate.
  await expect(replyGroup.getByRole("status")).toHaveText("Kept for your future self");

  // The kept line only reaches the server-rendered rail on the next load —
  // keeping is optimistic and never refreshes the page under it.
  await page.reload();
  const railNotes = page.getByLabel("Notes to your future self");
  await expect(railNotes).toContainText("mock reply");

  // The whole rail card links through to the full /notes screen.
  await railNotes.click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByText(/mock reply/)).toBeVisible();
  await expect(page.getByText("Kept from a conversation")).toBeVisible();

  // A second, hand-written note joins it — newest first, so it sits on top.
  await page
    .getByPlaceholder("Write something your future self should hear…")
    .fill("Rest is allowed.");
  const saved = page.waitForResponse(
    (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/notes",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  await expect(page.locator("main li").first().locator("p").first()).toHaveText("Rest is allowed.");
  await expect(page.getByText(/mock reply/)).toBeVisible();

  // Letting the hand-written one go takes two deliberate clicks; the kept line
  // from the conversation stays untouched.
  const newest = page.locator("main li").first();
  await newest.getByRole("button", { name: "Let it go" }).click();
  const deleted = page.waitForResponse(
    (res) => res.request().method() === "DELETE" && res.url().includes("/api/notes/"),
  );
  await newest.getByRole("button", { name: "Yes, let it go" }).click();
  await deleted;
  await expect(page.getByText("Rest is allowed.")).toHaveCount(0);
  await expect(page.getByText(/mock reply/)).toBeVisible();
});

test("rename a conversation from the rail menu", async ({ page }) => {
  await signUp(page);

  await page.getByLabel("Start a conversation").fill("Something worth keeping");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const conversationHref = new URL(page.url()).pathname;

  // Open the row's overflow menu and rename in place.
  await page.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();

  const renamePersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/conversations/"),
  );
  const input = page.getByRole("textbox", { name: "Rename conversation" });
  await input.fill("A named reflection");
  await input.press("Enter");
  await renamePersisted;

  // The new title shows in the rail immediately...
  await expect(
    page.locator(`a[href="${conversationHref}"]`).getByText("A named reflection"),
  ).toBeVisible();

  // ...and survives a reload onto the home cards.
  await page.goto("/chat");
  await expect(
    page.locator(`a[href="${conversationHref}"]`).getByText("A named reflection"),
  ).toBeVisible();
});
