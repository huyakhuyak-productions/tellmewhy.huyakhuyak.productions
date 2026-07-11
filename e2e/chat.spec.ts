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

test("a failed send keeps the words safe in the composer and can be retried", async ({
  page,
}) => {
  await signUp(page);

  await startFromHero(page, "I had a strange day");
  await expect(page).toHaveURL(CONVERSATION_URL);
  await expect(page.getByText("mock reply")).toBeVisible();

  const composer = page.getByPlaceholder("What's on your mind?");
  // Scoped to the form: Next's route announcer is also role="alert".
  const notice = page.locator("form [role='alert']");

  // Force the rate-limit shape deterministically (the real limiter needs 20
  // sends): the 429 becomes the calm breath notice and the words come back.
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "Slow down a little" }),
    }),
  );
  await composer.fill("The lamp is still on");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(notice).toContainText("Take a breath");
  await expect(composer).toHaveValue("The lamp is still on");

  // A generic failure offers the retry affordance — words still safe below.
  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (route) => route.fulfill({ status: 500, body: "" }));
  await page.getByRole("button", { name: "Send" }).click();
  await expect(notice).toContainText("That didn't send");
  await expect(composer).toHaveValue("The lamp is still on");

  // Let the route through again: Try again delivers the same words for real.
  await page.unroute("**/api/chat");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("The lamp is still on")).toBeVisible();
  await expect(page.getByText("mock reply")).toHaveCount(2);
  await expect(notice).toHaveCount(0);
  await expect(composer).toHaveValue("");
});

test("the hero's rate-limited create shows the server error and allows recovery", async ({
  page,
}) => {
  await signUp(page);

  // Mock the /api/conversations endpoint to return 429 with the actual rate-limit message.
  await page.route("**/api/conversations", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "A gentle pace — try again in a moment" }),
    }),
  );

  const input = page.getByRole("textbox", { name: /start a conversation/i });
  const alert = page.locator("form [role='alert']");

  await input.fill("I had a strange day");
  await page.getByRole("button", { name: /send/i }).click();

  // The error message from the server is parsed and shown in the alert.
  await expect(alert).toContainText("A gentle pace — try again in a moment");
  // The typed text remains safe in the input.
  await expect(input).toHaveValue("I had a strange day");

  // Remove the mock and allow the route through for recovery.
  await page.unroute("**/api/conversations");
  await page.getByRole("button", { name: /send/i }).click();

  // Recovery succeeds: navigation to the conversation.
  await expect(page).toHaveURL(CONVERSATION_URL);
  await expect(page.getByText("mock reply")).toBeVisible();
});

test("a self-guided thought record is saved and listed under records", async ({ page }) => {
  await signUp(page);

  await page.goto("/exercises");
  await page.getByRole("button", { name: "Start a thought record" }).click();

  // The worksheet opens in place; fill the four required reflections.
  await expect(page.getByRole("form", { name: "Thought record" })).toBeVisible();
  await page.getByLabel("The situation").fill("A long silence after I spoke up in the meeting");
  await page.getByLabel("Your thoughts").fill("They think I'm not up to this");
  await page.getByLabel("What you felt").fill("anxious and small");
  await page.getByLabel("What you did").fill("stayed quiet the rest of the call");

  const saved = page.waitForResponse(
    (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/entries",
  );
  await page.getByRole("button", { name: "Save this record" }).click();
  await saved;

  // Self-guided under no assignment: the save returns straight to the list —
  // the share prompt must never appear for a record with no assignment.
  await expect(page.getByRole("heading", { name: "Untangle a difficult moment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share this entry" })).toHaveCount(0);
  // The new record waits under "Your records", led by its situation.
  await expect(page.getByText("A long silence after I spoke up in the meeting")).toBeVisible();
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
