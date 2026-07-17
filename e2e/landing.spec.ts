import { expect, test } from "@playwright/test";

// Shared sign-up flow: create a fresh account and land on the home screen. Own
// helper per spec (mirrors desktop.spec.ts/chat.spec.ts), so the landing suite
// stays self-contained.
async function signUp(page: import("@playwright/test").Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  await page.goto("/sign-up");
  await page.getByPlaceholder("Your name").fill("E2E");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill("longenough-pass");
  await page.getByRole("button", { name: /start talking/i }).click();
  await expect(page).toHaveURL(/\/chat/);
}

test("the public front door renders the hero, the FAQ, and its structured data", async ({
  page,
}) => {
  // A brand-new context is signed out, so `/` serves the landing page itself.
  await page.goto("/");

  // The hero thesis and the FAQ are both present on the signed-out door.
  await expect(
    page.getByRole("heading", { name: /A private place to talk about how you feel/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "The honest answers" })).toBeVisible();
  await expect(page.getByText("Is this end-to-end encrypted?")).toBeVisible();

  // The three JSON-LD graphs (Organization, WebApplication, FAQPage) ship as
  // separate ld+json script tags a crawler can read verbatim.
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(3);
});

test("robots.txt keeps crawlers out of the private app", async ({ page }) => {
  const res = await page.request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("Disallow: /chat");
});

test("a signed-in visitor to the front door is sent straight to their room", async ({ page }) => {
  await signUp(page);

  // With a live session, `/` redirects to the app rather than showing the hero.
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat$/);
});
