import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Sign-up runs through the auth API (not the hydrating React form) so the whole
// journey turns on the deletion UI under test, never on form-typing flakiness —
// page.request shares the context's cookie jar, so the session lands the same as
// a real sign-in (see e2e conventions / HANDOFF's auth quirk).
async function signUpViaApi(
  page: Page,
  creds: { name: string; email: string; password: string },
): Promise<void> {
  const res = await page.request.post("/api/auth/sign-up/email", { data: creds });
  expect(res.ok()).toBeTruthy();
}

function freshCredentials() {
  return {
    name: "Del Eter",
    email: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`,
    password: "longenough-pass",
  };
}

// The whole self-deletion journey, end to end: a real account with a written
// message walks the two-step /account delete, lands on /goodbye, and can no
// longer sign in — the credentials now fail exactly like any stranger's would.
test("a person deletes their own account and can no longer sign in", async ({ page }) => {
  // A cold dev server compiles /chat, /account and /goodbye on first touch.
  test.setTimeout(90_000);

  const creds = freshCredentials();
  await signUpViaApi(page, creds);

  // --- One real conversation, so there's genuinely something to delete. ---
  await page.goto("/chat");
  await page.getByLabel("Start a conversation").fill("Something I want to write down once");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  await expect(page.getByText("mock reply")).toBeVisible();

  // --- Step 1 of the delete: unlock it with the password. ---
  await page.goto("/account");
  await expect(page.getByText(creds.email)).toBeVisible();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.getByPlaceholder("Enter your password to continue").fill(creds.password);
  await page.getByRole("button", { name: "Continue" }).click();

  // --- Step 2: the plain-spoken acknowledgment, then commit. The safe choice
  //     ("Keep my account") holds focus, so the delete is never fired by reflex. ---
  await expect(
    page.getByRole("heading", { name: "Are you sure you want to leave for good?" }),
  ).toBeVisible();
  const deleted = page.waitForResponse(
    (res) =>
      res.request().method() === "DELETE" && new URL(res.url()).pathname === "/api/account",
  );
  await page.getByRole("button", { name: "Delete everything" }).click();
  await deleted;

  // --- A 204 clears the cookie and walks to the honest goodbye. ---
  await expect(page).toHaveURL(/\/goodbye$/);
  await expect(page.getByRole("heading", { name: "Take care of yourself." })).toBeVisible();

  // --- The credentials are gone for good: signing in again fails with the very
  //     same invalid-credentials message any wrong login gets — never a hint
  //     that this account once existed. Done at the API level per the e2e
  //     convention (never synthetic typing against the hydrating sign-in form). ---
  const retry = await page.request.post("/api/auth/sign-in/email", {
    data: { email: creds.email, password: creds.password },
  });
  expect(retry.status()).toBe(401);
  expect((await retry.json()).message).toBe("Invalid email or password");
});
