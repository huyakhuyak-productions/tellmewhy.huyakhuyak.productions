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
  // visible text alone would be a strict-mode duplicate. Filter by text too:
  // message-copy.tsx mounts its own always-on role=status sr-only span in the
  // same reply group, so an unfiltered getByRole("status") now matches two nodes.
  await expect(
    replyGroup.getByRole("status").filter({ hasText: "Kept for your future self" }),
  ).toHaveText("Kept for your future self");

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

// The three quiet-action tests below all need a persisted first exchange:
// message actions (Edit/Regenerate/Copy) ride only on server rows, and a
// just-streamed reply is still client-only. Start from the hero, wait for the
// generated title to reach the rail (the persistence signal, same as the keep
// test), then reload to re-hydrate every message with its server id.
async function startAndPersist(
  page: import("@playwright/test").Page,
  firstMessage: string,
): Promise<string> {
  await page.getByLabel("Start a conversation").fill(firstMessage);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const conversationHref = new URL(page.url()).pathname;
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();
  await expect(
    page.locator(`a[href="${conversationHref}"]`).getByText("A quiet mock title"),
  ).toBeVisible({ timeout: 12_000 });
  await page.reload();
  return conversationHref;
}

test("editing a message branches a new version and the arrows walk both ways", async ({ page }) => {
  await signUp(page);
  const original = "I keep replaying a conversation from work";
  await startAndPersist(page, original);

  // Open the person's own message for editing and rewrite it (⌘↵ saves).
  const clientGroup = page.locator("div.group\\/msg").filter({ hasText: original });
  await clientGroup.hover();
  await clientGroup.getByRole("button", { name: "Edit this message" }).click();
  const editBox = page.getByRole("textbox", { name: "Edit your message" });
  const edited = "Actually it was something my brother said";
  await editBox.fill(edited);
  const branchStreamed = page.waitForResponse(
    (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/chat",
  );
  await editBox.press("Meta+Enter");
  await branchStreamed;

  // The edited words replace the original on the active path, and the version
  // arrows appear — this is version 2 of 2, so Next is disabled and Previous open.
  await expect(page.getByText(edited)).toBeVisible();
  await expect(page.getByTestId("version-switcher").getByText("2/2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next version" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous version" })).toBeEnabled();

  // Step back to version 1: the ORIGINAL message and its reply return.
  const switchedBack = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/active-leaf"),
  );
  await page.getByRole("button", { name: "Previous version" }).click();
  await switchedBack;
  await expect(page.getByText(original)).toBeVisible();
  await expect(page.getByText(edited)).toHaveCount(0);
  await expect(page.getByTestId("version-switcher").getByText("1/2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous version" })).toBeDisabled();

  // Step forward again: the edited branch is back on screen.
  const switchedForward = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/active-leaf"),
  );
  await page.getByRole("button", { name: "Next version" }).click();
  await switchedForward;
  await expect(page.getByText(edited)).toBeVisible();
  await expect(page.getByText(original)).toHaveCount(0);
});

test("regenerating a reply branches an AI sibling reachable by the arrows", async ({ page }) => {
  await signUp(page);
  await startAndPersist(page, "Something worth a second take");

  const replyGroup = page.locator("div.group\\/msg").filter({ hasText: "mock reply" });
  await replyGroup.hover();
  const regenerated = page.waitForResponse(
    (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/chat",
  );
  await replyGroup.getByRole("button", { name: "Regenerate this reply" }).click();
  await regenerated;

  // The regenerated reply is version 2 of 2 on the AI message: Next is disabled.
  await expect(page.getByTestId("version-switcher").getByText("2/2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next version" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous version" })).toBeEnabled();

  // Both siblings stay reachable — step back to the first, then forward again.
  // (Both mock replies read identically, so the switcher's own index readout is
  // the proof of navigation, not the message text.)
  const back = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/active-leaf"),
  );
  await page.getByRole("button", { name: "Previous version" }).click();
  await back;
  await expect(page.getByTestId("version-switcher").getByText("1/2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous version" })).toBeDisabled();

  const forward = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/active-leaf"),
  );
  await page.getByRole("button", { name: "Next version" }).click();
  await forward;
  await expect(page.getByTestId("version-switcher").getByText("2/2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next version" })).toBeDisabled();
});

test("a follow-up reply gains its action row without any reload", async ({ page }) => {
  await signUp(page);

  // First exchange from the hero, streamed in.
  await page.getByLabel("Start a conversation").fill("Let's think this through");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();

  // A SECOND message, sent from inside the conversation. The title watcher only
  // ever fires for the FIRST exchange (guarded on initialMessages.length), so
  // nothing but the plain-send settle refresh can surface this follow-up reply's
  // server id — and thus its Regenerate affordance. No reload, no goto here:
  // this pins the settle-refresh path the action tests above work around by
  // reloading (see startAndPersist).
  await page.getByPlaceholder("What's on your mind?").fill("And another thought");
  await page.getByRole("button", { name: "Send" }).click();

  // Both replies must carry a Regenerate control once the settle refresh adopts
  // server truth — proving even the follow-up reply, which no title watcher ever
  // touches, gains its actions without the person doing anything.
  await expect(page.getByRole("button", { name: "Regenerate this reply" })).toHaveCount(2, {
    timeout: 15_000,
  });
});

test("copying a reply flashes a confirmation and lands the text on the clipboard", async ({
  page,
}) => {
  await signUp(page);
  await startAndPersist(page, "A line worth carrying elsewhere");

  const replyGroup = page.locator("div.group\\/msg").filter({ hasText: "mock reply" });
  await replyGroup.hover();
  await replyGroup.getByRole("button", { name: "Copy this message" }).click();

  // The button flips to its copied state, the visible label flashes "Copied",
  // and the sr-only live region announces it — scope the status by text, since
  // message-keep mounts its own always-on role=status span in the same group.
  await expect(replyGroup.getByRole("button", { name: "Copied to clipboard" })).toBeVisible();
  await expect(replyGroup.getByText("Copied", { exact: true })).toBeVisible();
  await expect(
    replyGroup.getByRole("status").filter({ hasText: "Copied to clipboard" }),
  ).toHaveText("Copied to clipboard");

  // The real clipboard now holds the message's exact text.
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe("This is a **mock reply** for tests.");
});

test("stopping mid-stream keeps the honest partial reply and its actions", async ({ page }) => {
  await signUp(page);

  // A normal first exchange gets us into a conversation with a live composer;
  // its hero draft is cleared on the clean finish, so a later reload is safe.
  await page.getByLabel("Start a conversation").fill("Something to think through together");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();

  // A MOCK_SLOW message streams word-by-word (see models.ts), so there is a
  // reliable window to interrupt it. Composer sends stash no draft, so reloading
  // below never re-sends this message.
  await page.getByPlaceholder("What's on your mind?").fill("MOCK_SLOW walk me through this slowly");
  await page.getByRole("button", { name: "Send" }).click();

  // Once the first words appear the stream is open and the send button has
  // become the Stop control — hit it before the tail word ever arrives.
  await expect(page.getByText(/Slowly/)).toBeVisible();
  await page.getByRole("button", { name: "Stop generating" }).click();

  // The server persists the partial in its abort-aware onFinish, which may land
  // a beat after the client aborts — reload until the saved partial reappears.
  // It carries its actions (a real server row), holds the head word, and never
  // reached STREAMTAIL: an honest partial, not the whole reply.
  await expect(async () => {
    await page.reload();
    const partialGroup = page.locator("div.group\\/msg").filter({ hasText: "Slowly" });
    await expect(
      partialGroup.getByRole("button", { name: "Regenerate this reply" }),
    ).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("STREAMTAIL")).toHaveCount(0);
});

test("hiding a conversation moves it to the rail's Hidden drawer, then restores it", async ({
  page,
}) => {
  await signUp(page);

  // Two conversations, so the rail keeps a visible row after one is hidden — and
  // we hide the one we're NOT reading, a clean rail-row hide with no header chip.
  await page.getByLabel("Start a conversation").fill("A thread to tuck away");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const hiddenHref = new URL(page.url()).pathname;

  await page.goto("/chat");
  await page.getByLabel("Start a conversation").fill("A thread to keep in view");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);

  // Open the first conversation's rail row menu and hide it (confirm required).
  const row = page.locator(`div:has(> a[href="${hiddenHref}"])`).first();
  await row.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  await expect(page.getByRole("dialog", { name: "Hide conversation?" })).toBeVisible();
  const hidePersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/conversations/"),
  );
  await page.getByRole("button", { name: "Hide it" }).click();
  await hidePersisted;

  // The row leaves the rail's groups: its ONLY remaining copy now lives inside
  // the Hidden drawer (scoped by the drawer's own `hidden-conversation-row`
  // testid), and the Hidden disclosure appears in its place.
  await expect(page.locator(`a[href="${hiddenHref}"]`)).toHaveCount(1);
  await expect(
    page.getByTestId("hidden-conversation-row").locator(`a[href="${hiddenHref}"]`),
  ).toHaveCount(1);
  const hiddenDrawer = page.getByRole("button", { name: /^Hidden/ });
  await expect(hiddenDrawer).toBeVisible();

  // Expanding the drawer reveals the conversation with its Restore action.
  await hiddenDrawer.click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  const restored = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/conversations/"),
  );
  await page.getByRole("button", { name: "Restore" }).click();
  await restored;

  // The conversation returns to the rail (no longer in the drawer), and the
  // now-empty Hidden section is gone entirely.
  await expect(
    page.getByTestId("hidden-conversation-row").locator(`a[href="${hiddenHref}"]`),
  ).toHaveCount(0);
  await expect(page.locator(`a[href="${hiddenHref}"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Hidden/ })).toHaveCount(0);
});

test("opening a hidden conversation by direct link shows its chip and restores from it", async ({
  page,
}) => {
  await signUp(page);

  // Start a conversation and let its reply settle (a clean finish clears the
  // hero draft, so the later direct navigation never re-sends the message).
  await page.getByLabel("Start a conversation").fill("A thread to reopen from its own page");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/chat\/.+/);
  const hiddenHref = new URL(page.url()).pathname;
  const conversationId = hiddenHref.split("/").pop()!;
  await expect(
    page.locator('[data-streamdown="strong"]', { hasText: "mock reply" }),
  ).toBeVisible();

  // Hide it straight through the API — the surface under test is the
  // conversation view's own chip, not the rail's hide path.
  const hidden = await page.request.patch(`/api/conversations/${conversationId}`, {
    data: { hidden: true },
  });
  expect(hidden.ok()).toBeTruthy();

  // A direct link to a hidden conversation still opens for its owner (the loader
  // never hides it from them); the header wears a quiet chip that says so and
  // offers a one-tap restore. The rail's Hidden drawer is collapsed and inert,
  // so the only reachable "Restore" is the chip's own.
  await page.goto(hiddenHref);
  await expect(
    page.getByText("Hidden — only you can see your own hidden conversations."),
  ).toBeVisible();

  // Restoring from the chip round-trips the same PATCH the drawer uses, then
  // refreshes: the chip clears and the now-empty Hidden drawer disappears.
  const restored = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/conversations/"),
  );
  await page.getByRole("button", { name: "Restore" }).click();
  await restored;
  await expect(
    page.getByText("Hidden — only you can see your own hidden conversations."),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Hidden/ })).toHaveCount(0);
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
