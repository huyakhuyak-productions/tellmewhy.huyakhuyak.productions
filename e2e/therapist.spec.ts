import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Shared sign-up flow (mirrors chat.spec.ts/desktop.spec.ts's helper, but
// parametrized by name so two accounts in the same test read distinctly in
// the therapist desk's roster instead of colliding on "E2E").
async function signUp(page: Page, name: string): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  await page.goto("/sign-up");
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill("longenough-pass");
  await page.getByRole("button", { name: /start talking/i }).click();
  await expect(page).toHaveURL(/\/chat/);
}

// A signed-in client (on `page`) mints a single-use invite from /trust and
// hands back the bare "/link/<token>" path — the one moment the raw token is
// ever visible client-side (see trust-screen.tsx).
async function createInvitePath(page: Page): Promise<string> {
  await page.goto("/trust");
  const inviteCreated = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/links/invite"),
  );
  await page.getByRole("button", { name: "Invite a trusted person" }).click();
  await inviteCreated;
  const inviteUrl = await page.getByLabel("Invite link").inputValue();
  return new URL(inviteUrl).pathname;
}

// The other side of an invite: a brand-new, signed-out person follows the
// link, gets bounced through sign-in -> sign-up (threading `?next=` the whole
// way, exactly as an invite recipient would), and accepts. Ends on /chat with
// the link active and (for a client-initiated invite) the acceptor's role
// flipped to "therapist" server-side.
async function followInviteAndSignUp(page: Page, invitePath: string, name: string): Promise<void> {
  await page.goto(invitePath);
  // Not signed in yet: the landing page bounces to sign-in with `next` intact.
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(invitePath)}`));
  await page.getByRole("link", { name: "Create your space" }).click();
  await expect(page).toHaveURL(new RegExp(`/sign-up\\?next=${encodeURIComponent(invitePath)}`));

  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill("longenough-pass");
  await page.getByRole("button", { name: /start talking/i }).click();

  // Sign-up's own destination is the threaded `next` — right back at the
  // invite landing, now with a session.
  await expect(page).toHaveURL(new RegExp(invitePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const acceptCompleted = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/api/links/accept"),
  );
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await acceptCompleted;
  await expect(page.getByRole("status")).toContainText("connected");
  // AcceptInvite pushes to /chat ~1.1s after the confirmation renders.
  await expect(page).toHaveURL(/\/chat$/, { timeout: 5_000 });
}

test.describe.configure({ mode: "serial" });

test("the whole therapist journey: link, share, read, intervene, and revoke", async ({ browser }) => {
  // Generous: a cold dev server compiles each route on demand, and this one
  // long test is the first to touch most of the therapist surface.
  test.setTimeout(120_000);

  // Two fully independent sessions for the two sides of the relationship.
  const clientCtx = await browser.newContext();
  const therapistCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  const therapist = await therapistCtx.newPage();

  try {
    // --- Step 1: the client signs up and invites a trusted person. ---
    await signUp(client, "Ada Client");
    const invitePath = await createInvitePath(client);

    // --- Step 2: the therapist follows the link, signs up, and accepts. ---
    await followInviteAndSignUp(therapist, invitePath, "Tom Therapist");

    // --- Step 3: the client starts a conversation and gets a reply. ---
    await client.goto("/chat");
    await client.getByLabel("Start a conversation").fill("I keep replaying a conversation from work");
    await client.keyboard.press("Enter");
    await expect(client).toHaveURL(/\/chat\/.+/);
    const conversationHref = new URL(client.url()).pathname;
    await expect(client.getByText("mock reply")).toBeVisible();

    // --- Step 4: the client shares that conversation with their therapist. ---
    const shareLanded = client.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/share"),
    );
    await client.getByRole("button", { name: /^Share with/ }).click();
    await shareLanded;
    await expect(client.getByRole("button", { name: "Shared with Tom Therapist" })).toBeVisible();

    // --- Step 5: the therapist's dashboard shows the new client. ---
    await therapist.goto("/therapist");
    await expect(therapist.getByText("1 person trusts you with what they've written.")).toBeVisible();
    await therapist.getByRole("link", { name: "Open Ada Client" }).click();
    await expect(therapist).toHaveURL(/\/therapist\/clients\/.+/);

    // --- Step 6: the therapist opens and reads the shared conversation. ---
    await therapist.getByRole("link", { name: /^Read /}).click();
    await expect(therapist).toHaveURL(/\/therapist\/conversations\/.+/);
    const readingUrl = therapist.url();
    await expect(therapist.getByText("I keep replaying a conversation from work")).toBeVisible();
    await expect(therapist.getByText("mock reply")).toBeVisible();

    // --- Step 7: the therapist marks the conversation read to the last message. ---
    const markerLanded = therapist.waitForResponse(
      (res) => res.request().method() === "PUT" && res.url().includes("/review-marker"),
    );
    await therapist.getByRole("button", { name: "Mark read to here" }).last().click();
    await markerLanded;
    await expect(therapist.getByRole("separator", { name: "Your review line" })).toBeVisible();

    // --- Step 8: the therapist sends an intervention, as themselves. ---
    const interventionText = "I'm right here with you — let's talk about this together next time.";
    const interventionLanded = therapist.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/intervention"),
    );
    await therapist.getByLabel("Write a message as yourself").fill(interventionText);
    await therapist.getByRole("button", { name: "Send as yourself" }).click();
    await interventionLanded;
    await expect(therapist.getByText(interventionText)).toBeVisible();

    // --- Step 9: back on the client card, the therapist publishes a note and AI guidance. ---
    await therapist.getByText("Back to their conversations").click();
    await expect(therapist).toHaveURL(/\/therapist\/clients\/.+/);

    const noteText = "Thank you for sharing this with me — you're not alone in it.";
    const notePublished = therapist.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/api/therapist/notes"),
    );
    await therapist.getByLabel("Write a note to Ada Client").fill(noteText);
    await therapist.getByRole("button", { name: "Publish to Ada Client" }).click();
    await notePublished;

    const guidanceText = "Validate her feelings gently before offering any suggestions.";
    const guidanceSaved = therapist.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/api/therapist/notes"),
    );
    await therapist.getByLabel("Write AI guidance").fill(guidanceText);
    await therapist.getByRole("button", { name: "Save AI guidance" }).click();
    await guidanceSaved;
    await expect(therapist.getByText("Active · version 1")).toBeVisible();

    // --- Step 10: the client reloads the conversation and sees the human presence. ---
    await client.goto(conversationHref);
    await expect(
      client.getByRole("separator", { name: "Reviewed by Tom Therapist up to here" }),
    ).toBeVisible();
    // Scoped to the intervention's own bubble: "Tom Therapist" also appears in
    // the desktop StatsRail's therapist panel, so an unscoped exact-text match
    // would hit both and trip Playwright's strict mode.
    const interventionBubble = client.locator(".cp-panel", { hasText: interventionText });
    await expect(interventionBubble.getByText("Tom Therapist", { exact: true })).toBeVisible();
    await expect(interventionBubble.getByText("your therapist")).toBeVisible();
    await expect(interventionBubble.getByText(interventionText)).toBeVisible();

    // --- Step 11: /trust shows the audit trail and the published note. ---
    await client.goto("/trust");
    await expect(client.getByText("Tom Therapist read a shared conversation")).toBeVisible();
    await expect(client.getByText("Tom Therapist marked how far they'd read")).toBeVisible();
    await expect(client.getByText("Tom Therapist wrote to you")).toBeVisible();
    await expect(client.getByText("Tom Therapist left you a note")).toBeVisible();
    await expect(client.getByText(noteText)).toBeVisible();

    // --- Step 12: the client sends another message — the AI-instruction path runs. ---
    await client.goto(conversationHref);
    await client.getByPlaceholder("What's on your mind?").fill("Still thinking about it today.");
    await client.getByRole("button", { name: "Send" }).click();
    await expect(client.getByText("mock reply")).toHaveCount(2);

    // --- Step 13: the client revokes sharing on this one conversation. ---
    await client.goto("/trust");
    const shareRevoked = client.waitForResponse(
      (res) => res.request().method() === "DELETE" && res.url().includes("/share"),
    );
    await client.getByRole("button", { name: /^Stop sharing/ }).click();
    await shareRevoked;
    await expect(
      client.getByText("You're not sharing any conversations yet."),
    ).toBeVisible();

    // --- Step 14: the therapist's reading view of that conversation now 404s. ---
    const revokedResponse = await therapist.goto(readingUrl);
    expect(revokedResponse?.status()).toBe(404);

    // --- Step 15: the client revokes the link itself. ---
    await client.goto("/trust");
    await client.getByRole("button", { name: "End connection" }).click();
    const linkRevoked = client.waitForResponse(
      (res) => res.request().method() === "DELETE" && res.url().includes("/api/links/"),
    );
    await client.getByRole("button", { name: "Yes, end it" }).click();
    await linkRevoked;
    await expect(client.getByText("You haven't invited anyone yet.")).toBeVisible();

    // --- Step 16: the therapist's dashboard is empty again. ---
    await therapist.goto("/therapist");
    await expect(therapist.getByText("No one has linked with you yet.").first()).toBeVisible();
  } finally {
    await clientCtx.close();
    await therapistCtx.close();
  }
});

// The crisis navigator + visibility treatment: a shared conversation carrying a
// crisis-flagged message shows the therapist an unmistakable amber frame and a
// Telegram-style X/N navigator to jump to it. AI_MOCK flags any message whose
// text contains MOCK_CRISIS, so this is fully deterministic.
test("the reading view frames crisis messages and offers a crisis navigator", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const clientCtx = await browser.newContext();
  const therapistCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  const therapist = await therapistCtx.newPage();

  try {
    // --- Link a client and therapist. ---
    await signUp(client, "Vera Client");
    const invitePath = await createInvitePath(client);
    await followInviteAndSignUp(therapist, invitePath, "Ola Therapist");

    // --- The client writes something heavy; AI_MOCK flags it as a crisis. ---
    await client.goto("/chat");
    await client.getByLabel("Start a conversation").fill("MOCK_CRISIS I don't want to be here anymore");
    await client.keyboard.press("Enter");
    await expect(client).toHaveURL(/\/chat\/.+/);
    // The crisis breaks the frame into the docked support card — proof the
    // message landed and was classified as a crisis.
    await expect(client.getByRole("alertdialog", { name: /support resources/i })).toBeVisible();

    // --- The client shares that conversation with their therapist. ---
    const shareLanded = client.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/share"),
    );
    await client.getByRole("button", { name: /^Share with/ }).click();
    await shareLanded;

    // --- The therapist opens the shared conversation. ---
    await therapist.goto("/therapist");
    await therapist.getByRole("link", { name: "Open Vera Client" }).click();
    await therapist.getByRole("link", { name: /^Read /}).click();
    await expect(therapist).toHaveURL(/\/therapist\/conversations\/.+/);

    // --- The crisis message wears the visible amber treatment. ---
    const crisisMessage = therapist.locator('[data-crisis="true"]');
    await expect(crisisMessage).toHaveCount(1);
    await expect(crisisMessage).toContainText("I don't want to be here anymore");
    // The Crisis pill rides in the message's own header, not floating below.
    // Exact match: the message body itself contains the word "MOCK_CRISIS", so
    // only the pill — whose text is exactly "Crisis" — should be caught here.
    await expect(crisisMessage.getByText("Crisis", { exact: true })).toBeVisible();

    // --- The navigator shows "1 crisis message" before landing and clamps at both ends. ---
    await expect(therapist.getByText("1 crisis message")).toBeVisible();
    const prev = therapist.getByRole("button", { name: "Previous crisis message" });
    const next = therapist.getByRole("button", { name: "Next crisis message" });
    // Nothing sits before position 1, so Previous is disabled from the start.
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    // Stepping lands on the only crisis, scrolls it into view, announces "1/1",
    // and — being both first and last — disables both arrows without ever wrapping.
    await next.click();
    await expect(crisisMessage).toBeInViewport();
    await expect(therapist.getByText("1/1")).toBeVisible();
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(prev).toHaveAttribute("aria-disabled", "true");
  } finally {
    await clientCtx.close();
    await therapistCtx.close();
  }
});

// The Phase 3 enrichments end-to-end across the two sides: a therapist assigns
// a thought record, the client completes and shares it, the therapist reads the
// engagement and the entry, opens the shared conversation for its AI digest, and
// the client shares (then unshares) their mood trend. The adversarial tail then
// proves a link revoke tears down all three new surfaces at once. Fully
// deterministic under AI_MOCK: a fixed digest overview and theme, plus a single
// anchor on the first message that the therapist clicks to jump to it.
test("the enrichment journey: assign, complete, share, read, digest, and mood trend", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const clientCtx = await browser.newContext();
  const therapistCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  const therapist = await therapistCtx.newPage();

  try {
    // --- Link a client and therapist. ---
    await signUp(client, "Mia Client");
    const invitePath = await createInvitePath(client);
    await followInviteAndSignUp(therapist, invitePath, "Ken Therapist");

    // --- The client starts and shares a conversation (the digest reads it). ---
    await client.goto("/chat");
    await client.getByLabel("Start a conversation").fill("I froze in the team meeting again");
    await client.keyboard.press("Enter");
    await expect(client).toHaveURL(/\/chat\/.+/);
    await expect(client.getByText("mock reply")).toBeVisible();
    const shareLanded = client.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /^\/api\/conversations\/[^/]+\/share$/.test(new URL(res.url()).pathname),
    );
    await client.getByRole("button", { name: /^Share with/ }).click();
    await shareLanded;

    // --- The therapist opens the client and assigns a thought record. ---
    await therapist.goto("/therapist");
    await therapist.getByRole("link", { name: "Open Mia Client" }).click();
    await expect(therapist).toHaveURL(/\/therapist\/clients\/.+/);
    const clientDeskUrl = therapist.url();

    const instruction = "Walk back through the moment you froze, a step at a time.";
    const assignLanded = therapist.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/exercises"),
    );
    await therapist.getByLabel("Thought record instruction").fill(instruction);
    await therapist.getByRole("button", { name: "Assign thought record" }).click();
    await assignLanded;
    // The fresh assignment shows with an honest, content-free engagement line.
    await expect(therapist.getByText(instruction)).toBeVisible();
    await expect(therapist.getByText("No entries yet")).toBeVisible();

    // --- The client sees the assignment and completes its worksheet. ---
    await client.goto("/exercises");
    await client.getByRole("button", { name: `Open assignment: ${instruction}` }).click();
    await expect(client.getByRole("form", { name: "Thought record" })).toBeVisible();
    await client.getByLabel("The situation").fill("The room went quiet and everyone looked at me");
    await client.getByLabel("Your thoughts").fill("I have nothing worth saying");
    await client.getByLabel("What you felt").fill("panic, shame");
    await client.getByLabel("What you did").fill("looked at my notes and said nothing");
    const entrySaved = client.waitForResponse(
      (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/entries",
    );
    await client.getByRole("button", { name: "Save this record" }).click();
    await entrySaved;

    // --- The one non-coercive share prompt follows; the client shares it. ---
    const entryShared = client.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        /^\/api\/entries\/[^/]+\/share$/.test(new URL(res.url()).pathname),
    );
    await client.getByRole("button", { name: "Share this entry" }).click();
    await entryShared;

    // --- The therapist now sees engagement AND can read the shared entry. ---
    await therapist.goto(clientDeskUrl);
    await expect(therapist.getByText("1 entry")).toBeVisible();
    await therapist.getByRole("button", { name: "Read shared record" }).click();
    await expect(
      therapist.getByText("The room went quiet and everyone looked at me"),
    ).toBeVisible();

    // --- The therapist opens the shared conversation; the AI digest renders. ---
    await therapist.getByRole("link", { name: /^Read /}).click();
    await expect(therapist).toHaveURL(/\/therapist\/conversations\/.+/);
    const readingUrl = therapist.url();
    const digest = therapist.locator('section[aria-label="Session digest"]');
    // The panel fetches on mount; the disclosure button is disabled until the
    // digest lands, so waiting for it to enable is the "ready" signal.
    const digestToggle = digest.getByRole("button").first();
    await expect(digestToggle).toBeEnabled();
    // Target the disclosure button's title, not the sr-only live-status span
    // (which mirrors the same text) — getByText would match both.
    await expect(digest.getByRole("button", { name: /Session digest/ })).toBeVisible();
    await digestToggle.click();
    // Mock content: the overview prose, the single theme chip, and one anchor —
    // the mock echoes the first transcript message id, which survives the
    // domain's hallucination filter because it's a real message of this
    // conversation.
    await expect(digest.getByText("A mock digest overview.")).toBeVisible();
    await expect(digest.getByText("mock theme")).toBeVisible();

    // Clicking the anchor lands on that first message — the same scroll-into-
    // view landing the crisis navigator uses (reading-view's shared landOn).
    await digest.getByRole("button", { name: "Jump to a moment: A mock anchor" }).click();
    await expect(therapist.getByText("I froze in the team meeting again")).toBeInViewport();

    // --- The client checks in a mood, then shares the trend. ---
    await client.goto("/chat");
    const moodSaved = client.waitForResponse(
      (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/mood",
    );
    await client.getByRole("button", { name: "Good — 4 of 5" }).click();
    await moodSaved;

    await client.goto("/trust");
    const moodShareOn = client.waitForResponse(
      (res) =>
        res.request().method() === "PUT" && new URL(res.url()).pathname === "/api/mood/sharing",
    );
    await client.getByRole("switch", { name: "Share my mood trend" }).click();
    await moodShareOn;

    // --- The therapist's client view now shows the shared trend and its dot. ---
    await therapist.goto(clientDeskUrl);
    const moodPanel = therapist.locator('section[aria-labelledby="mood-heading"]');
    await expect(moodPanel).toBeVisible();
    await expect(moodPanel.getByText("Mia Client")).toBeVisible();
    await expect(moodPanel.getByRole("img", { name: /Mood over the last 8 weeks/ })).toBeVisible();

    // --- Toggling it off makes the panel vanish — indistinguishable from no data. ---
    await client.goto("/trust");
    const moodShareOff = client.waitForResponse(
      (res) =>
        res.request().method() === "PUT" && new URL(res.url()).pathname === "/api/mood/sharing",
    );
    await client.getByRole("switch", { name: "Share my mood trend" }).click();
    await moodShareOff;
    await therapist.goto(clientDeskUrl);
    await expect(therapist.locator('section[aria-labelledby="mood-heading"]')).toHaveCount(0);

    // --- Adversarial: revoking the link tears down all three new surfaces. ---
    await client.goto("/trust");
    await client.getByRole("button", { name: "End connection" }).click();
    const linkRevoked = client.waitForResponse(
      (res) => res.request().method() === "DELETE" && res.url().includes("/api/links/"),
    );
    await client.getByRole("button", { name: "Yes, end it" }).click();
    await linkRevoked;

    // The digest request 404s — no grant survives the revoke.
    const conversationId = readingUrl.split("/").pop();
    const digestAfter = await therapist.request.get(
      `/api/therapist/conversations/${conversationId}/digest`,
    );
    expect(digestAfter.status()).toBe(404);

    // And the client desk itself is gone: no mood or exercise panels remain.
    const deskAfter = await therapist.goto(clientDeskUrl);
    expect(deskAfter?.status()).toBe(404);
  } finally {
    await clientCtx.close();
    await therapistCtx.close();
  }
});

// Every path a hostile or merely mistaken party might try, refused the same
// calm way the rest of the therapist layer refuses: 404 or an unremarkable
// error, never a hint at what's actually being protected.
test("adversarial: cross-tenant reads, role boundaries, and reused tokens are all refused", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const clientACtx = await browser.newContext();
  const therapistACtx = await browser.newContext();
  const clientBCtx = await browser.newContext();
  const therapistBCtx = await browser.newContext();
  const clientA = await clientACtx.newPage();
  const therapistA = await therapistACtx.newPage();
  const clientB = await clientBCtx.newPage();
  const therapistB = await therapistBCtx.newPage();

  try {
    // --- Set up pair A: a client with a real therapist and a shared conversation. ---
    await signUp(clientA, "Nia Client");
    const invitePathA = await createInvitePath(clientA);
    await followInviteAndSignUp(therapistA, invitePathA, "Rae Therapist");

    await clientA.goto("/chat");
    await clientA.getByLabel("Start a conversation").fill("Something private for my own therapist");
    await clientA.keyboard.press("Enter");
    await expect(clientA).toHaveURL(/\/chat\/.+/);
    await expect(clientA.getByText("mock reply")).toBeVisible();

    const shareLanded = clientA.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/share"),
    );
    await clientA.getByRole("button", { name: /^Share with/ }).click();
    await shareLanded;

    await therapistA.goto("/therapist");
    await therapistA.getByRole("link", { name: "Open Nia Client" }).click();
    await therapistA.getByRole("link", { name: /^Read /}).click();
    const grantedReadingUrl = therapistA.url();
    await expect(therapistA.getByText("Something private for my own therapist")).toBeVisible();

    // --- Set up pair B: an entirely unrelated client/therapist pair. ---
    await signUp(clientB, "Leo Client");
    const invitePathB = await createInvitePath(clientB);
    await followInviteAndSignUp(therapistB, invitePathB, "Sam Therapist");

    // --- Adversarial 1: therapist B direct-URLs pair A's granted conversation. ---
    const foreignResponse = await therapistB.goto(grantedReadingUrl);
    expect(foreignResponse?.status()).toBe(404);

    // --- Adversarial 2: a client-role account hits the therapist surfaces directly. ---
    const dashboardResponse = await clientA.goto("/therapist");
    expect(dashboardResponse?.status()).toBe(404);

    const apiResponse = await clientA.request.get("/api/therapist/clients");
    expect(apiResponse.status()).toBe(404);
    expect(await apiResponse.json()).toEqual({ error: "Not found" });

    // --- Adversarial 3: the already-accepted invite token is rejected, calmly. ---
    // clientB is signed in but has nothing to do with pair A's invite — a
    // stand-in for anyone who still has (or finds) a used invite link.
    await clientB.goto(invitePathA);
    await expect(clientB).toHaveURL(invitePathA);
    await clientB.getByRole("button", { name: "Accept invitation" }).click();
    // Next's own route-announcer div also carries role="alert" (empty, for
    // client-side nav a11y) — filter to the one with actual text.
    const acceptError = clientB.getByRole("alert").filter({ hasText: "Invite not found" });
    await expect(acceptError).toContainText("Invite not found or already used");
    // No acceptance happened: still on the landing page, not bounced to /chat.
    await expect(clientB).toHaveURL(invitePathA);
  } finally {
    await clientACtx.close();
    await therapistACtx.close();
    await clientBCtx.close();
    await therapistBCtx.close();
  }
});
