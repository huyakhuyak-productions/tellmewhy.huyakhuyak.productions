import { expect, test } from "@playwright/test";

// Matches the conversation id Next.js routes to after the hero handoff.
const CONVERSATION_URL = /\/chat\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

// Start a conversation from the home hero: the first sentence is written on the
// front door, then the composer creates the conversation and navigates into it.
async function startFromHero(page: import("@playwright/test").Page, text: string) {
  await page.getByRole("textbox", { name: /start a conversation/i }).fill(text);
  await page.getByRole("button", { name: /send/i }).click();
}

test("start a conversation from the home hero", async ({ page }) => {
  await signUp(page);

  await startFromHero(page, "I had a strange day");
  await expect(page).toHaveURL(CONVERSATION_URL);

  // TODO(Task 7): the hero stashes the first message under
  // `tellmewhy:draft:<id>` and ChatScreen's mount-send consumes it on arrival.
  // Once that lands, extend here with:
  //   await expect(page.getByText("mock reply")).toBeVisible();
  //   await expect(
  //     page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  //   ).toBeVisible();
});

test("a crisis first message reaches the conversation", async ({ page }) => {
  await signUp(page);

  await startFromHero(page, "MOCK_CRISIS I want to kill myself");
  await expect(page).toHaveURL(CONVERSATION_URL);

  // TODO(Task 7): with mount-send in place the crisis message is delivered on
  // arrival and breaks the chat frame. Once that lands, extend here with:
  //   await expect(
  //     page.getByRole("alertdialog", { name: /support resources/i }),
  //   ).toBeVisible();
  //   await expect(page.getByText(/988/)).toBeVisible();
});
