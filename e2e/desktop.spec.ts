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
