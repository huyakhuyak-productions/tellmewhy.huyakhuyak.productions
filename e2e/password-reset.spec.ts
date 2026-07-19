import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// UI-LEVEL ONLY, on purpose. This spec proves the enumeration-free contract of
// the /forgot-password screen: every address — registered or not — lands on the
// exact same calm confirmation, so the page can never be used to tell whether an
// email has an account. The reset TOKEN round-trip (email -> link -> new
// password -> revoked sessions) is NOT exercised here: the mock outbox that
// carries the link lives in the server process's memory (see src/lib/email.ts),
// out of Playwright's reach across the dev-server boundary, so that half is
// covered by the server-side integration tests in src/lib/password-reset.test.ts.

// The one line of copy the confirmation is allowed to say, whoever asked.
const CONFIRMATION = "If that address has an account, a reset link is on its way.";

async function submitForgotPassword(page: Page, email: string): Promise<void> {
  await page.goto("/forgot-password");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(page.getByText(CONFIRMATION)).toBeVisible();
}

test("forgot-password gives every address the same enumeration-free confirmation", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // A genuinely registered address (created through the auth API, so it truly
  // exists server-side) — the case an attacker would hope looks different.
  const registered = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  const created = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Reg Istered", email: registered, password: "longenough-pass" },
  });
  expect(created.ok()).toBeTruthy();

  // An address that was never registered.
  const unknown = `e2e-nobody-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;

  // Both land on the identical confirmation — no oracle, either way.
  await submitForgotPassword(page, registered);
  await submitForgotPassword(page, unknown);
});
