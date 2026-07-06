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

  // The hero stashes the first message under `tellmewhy:draft:<id>` and
  // ChatScreen's mount-send consumes it on arrival, so the assistant's streamed
  // reply lands without any further typing.
  await expect(page.getByText("mock reply")).toBeVisible();
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();
});

test("a crisis first message reaches the conversation", async ({ page }) => {
  await signUp(page);

  await startFromHero(page, "MOCK_CRISIS I want to kill myself");
  await expect(page).toHaveURL(CONVERSATION_URL);

  // With mount-send in place the crisis message is delivered on arrival and
  // breaks the chat frame into the docked support card.
  await expect(
    page.getByRole("alertdialog", { name: /support resources/i }),
  ).toBeVisible();
  await expect(page.getByText(/988/)).toBeVisible();
});

test("the generated title shows on the home card after a client-side navigation", async ({
  page,
}) => {
  await signUp(page);

  await startFromHero(page, "Thinking about a career change");
  await expect(page).toHaveURL(CONVERSATION_URL);
  await expect(page.getByText("mock reply")).toBeVisible();

  // The auto-title lands via a fire-and-forget rename after the stream closes
  // (see api/chat/route.ts's onFinish) — there is no client signal for "done"
  // on this screen (only ChatScreen polls; the home page doesn't), so give the
  // mock title model its brief moment to land before navigating away.
  await page.waitForTimeout(2000);

  // Phones have no rail — "Back to your conversations" is the only home link,
  // and it's a next/link (client-side, no page.reload()).
  await page.getByRole("link", { name: "Back to your conversations" }).click();
  await expect(page).toHaveURL(/\/chat$/);

  await expect(page.getByText("A quiet mock title")).toBeVisible();
});

test("rename a conversation from the home card menu", async ({ page }) => {
  await signUp(page);

  await startFromHero(page, "A phone thought");
  await expect(page).toHaveURL(CONVERSATION_URL);
  const conversationHref = new URL(page.url()).pathname;

  // Phones have no rail — the card's overflow menu is the only path to rename.
  await page.goto("/chat");
  await page.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();

  const renamePersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/conversations/"),
  );
  const input = page.getByRole("textbox", { name: "Rename conversation" });
  await input.fill("Named from my phone");
  await input.press("Enter");
  await renamePersisted;

  await expect(
    page.locator(`a[href="${conversationHref}"]`).getByText("Named from my phone"),
  ).toBeVisible();
});
