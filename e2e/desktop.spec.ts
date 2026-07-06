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
