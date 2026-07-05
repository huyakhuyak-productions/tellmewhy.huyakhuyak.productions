import { expect, test } from "@playwright/test";

// Shared sign-up flow: create a fresh account and land on the conversation list.
async function signUp(page: import("@playwright/test").Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  await page.goto("/sign-up");
  await page.getByPlaceholder("Your name").fill("E2E");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill("longenough-pass");
  await page.getByRole("button", { name: /start talking/i }).click();
  await expect(page).toHaveURL(/\/chat/);
}

test("sign up, chat, get a streamed AI reply", async ({ page }) => {
  await signUp(page);

  await page.getByRole("button", { name: /new conversation/i }).click();
  await expect(page).toHaveURL(/\/chat\/.+/);

  // Selector adapted from the brief: the composer is a placeholder-identified
  // textarea (`getByRole("textbox").last()` was ambiguous/fragile — there's
  // only ever one textbox on this screen, and the placeholder is sturdier).
  await page.getByPlaceholder(/what's on your mind/i).fill("I had a strange day");
  // Selector adapted from the brief: the send control is an icon-only button
  // with aria-label="Send" (no visible text), so role+name still matches.
  await page.getByRole("button", { name: /send/i }).click();

  await expect(page.getByText("mock reply")).toBeVisible();
  // Markdown is rendered, not shown raw. Selector adapted from the brief: the
  // installed Streamdown version emits a styled `<span data-streamdown="strong">`
  // for bold text, not a literal `<strong>` element (verified by inspecting
  // the rendered DOM) — assert on that semantic marker instead.
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();
});

test("crisis message breaks the chat frame with resources", async ({ page }) => {
  await signUp(page);

  await page.getByRole("button", { name: /new conversation/i }).click();
  await expect(page).toHaveURL(/\/chat\/.+/);

  await page.getByPlaceholder(/what's on your mind/i).fill("MOCK_CRISIS I want to kill myself");
  await page.getByRole("button", { name: /send/i }).click();

  await expect(page.getByRole("alertdialog", { name: /support resources/i })).toBeVisible();
  await expect(page.getByText(/988/)).toBeVisible();
});
