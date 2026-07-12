import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { MockLanguageModelV3 } from "ai/test";
import { createConversation, isTitleCustomized, listConversations, loadMessages, renameConversation, saveMessage } from "@/lib/conversations";
import { getKeyProvider } from "@/lib/crypto/key-provider";
import chatRateLimiter from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { user } from "@/db/schema";
import { acceptInvite, createInvite, getActiveLinkForClient, revokeLink } from "@/lib/therapist-links";
import { getGrantStateForClient, grantConversation, revokeGrant } from "@/lib/sharing";
import { createNote, getActiveAiInstruction } from "@/lib/therapist-notes";
import { createNote as createSelfNote } from "@/lib/notes";
import { sendIntervention } from "@/lib/interventions";
import { assignExercise, closeExercise } from "@/lib/exercises";
import { checkInMood } from "@/lib/mood";
import { getChatModel, getTitleModel } from "@/lib/ai/models";

// Auth is mocked at the module boundary; everything below it is real
// (repo, crypto, mock models via AI_MOCK=1).
const userId = `test-${randomUUID()}`;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: userId } })) } },
}));
// next/headers needs Next.js request scope — stub it for direct route invocation.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Spy-mode keeps the real implementation by default, so the happy-path tests
// below are unaffected — only the failure test overrides a single call.
vi.mock("@/lib/conversations", { spy: true });
// Same spy-mode shape: these back the therapist-boundary tests below, which
// assert on real query counts (getActiveLinkForClient) and real behavior
// (getGrantStateForClient, getActiveAiInstruction) rather than stub returns.
vi.mock("@/lib/therapist-links", { spy: true });
vi.mock("@/lib/sharing", { spy: true });
vi.mock("@/lib/therapist-notes", { spy: true });
// Spied so the model instance each POST creates (and its recorded
// doStreamCalls) is inspectable via getChatModel's own mock.results.
vi.mock("@/lib/ai/models", { spy: true });

import { POST } from "./route";

async function insertUser(name: string): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: "therapist",
  });
  return id;
}

// Reads the LanguageModelV3 prompt the chat model actually received for the
// most recent POST — the only reliable way to prove role mapping and system
// prompt content without re-implementing the ai SDK's own conversion.
function lastChatPrompt() {
  const results = vi.mocked(getChatModel).mock.results;
  const model = results.at(-1)!.value as MockLanguageModelV3;
  return model.doStreamCalls.at(-1)!.prompt;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function chatRequest(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  it("streams a reply and persists both messages encrypted", async () => {
    const { id } = await createConversation(userId, "Test chat");
    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish persistence runs
    await vi.waitFor(async () => {
      const msgs = await loadMessages(id, userId);
      expect(msgs.map((m) => m.sender)).toEqual(["client", "ai"]);
      expect(msgs[1].text).toContain("mock reply");
    });
  });

  // saveMessage runs twice (client turn, AI reply), loadMessages runs once,
  // and the title-generation branch runs renameConversation once — four call
  // sites that would each unwrap this user's DEK without per-request
  // memoization (see request-scope.ts / user-keys.ts).
  it("unwraps the user's DEK once per request despite four call sites", async () => {
    const { id } = await createConversation(userId, "Untitled"); // seeds the row, one unwrap outside the spy
    const unwrapSpy = vi.spyOn(getKeyProvider(), "unwrapDek");

    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    await res.text(); // drain the stream so onFinish (saveMessage + rename) runs

    await vi.waitFor(() => {
      expect(unwrapSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("marks crisis messages and reports the level in a header", async () => {
    const { id } = await createConversation(userId, "Hard night");
    const res = await POST(chatRequest({ conversationId: id, text: "I want to kill myself" }));
    expect(res.headers.get("x-risk-level")).toBe("crisis");
    await res.text();
    const [clientMsg] = await loadMessages(id, userId);
    expect(clientMsg.riskLevel).toBe("crisis");
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
    const res = await POST(chatRequest({ conversationId: randomUUID(), text: "hi" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 (not a 500) for a malformed JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a conversation the user does not own", async () => {
    const foreign = await createConversation("someone-else", "Not yours");
    const res = await POST(chatRequest({ conversationId: foreign.id, text: "hi" }));
    expect(res.status).toBe(404);
  });

  it("logs and does not crash when persisting the AI reply fails", async () => {
    const { id } = await createConversation(userId, "Persistence hiccup");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockedSaveMessage = vi.mocked(saveMessage);
    const realSaveMessage = mockedSaveMessage.getMockImplementation()!;
    // First call (the client message) goes through to the real implementation;
    // the second call (the AI reply, made from onFinish) rejects.
    mockedSaveMessage.mockImplementationOnce(realSaveMessage);
    mockedSaveMessage.mockImplementationOnce(async () => {
      throw new Error("simulated persistence failure");
    });

    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish (and its failed save) runs

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
    const [logMessage, loggedError] = consoleErrorSpy.mock.calls[0]!;
    expect(logMessage).toContain(id);
    expect(loggedError).toBeInstanceOf(Error);

    const msgs = await loadMessages(id, userId);
    expect(msgs.map((m) => m.sender)).toEqual(["client"]);
  });

  it("auto-titles the conversation after the first exchange", async () => {
    const { id } = await createConversation(userId, "Untitled");
    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so onFinish (and the title call) runs

    await vi.waitFor(async () => {
      const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
      expect(conversation?.title).toBe("A quiet mock title");
    });
    expect(await isTitleCustomized(id, userId)).toBe(false);
  });

  it("does not retitle on the second exchange in the same conversation", async () => {
    const { id } = await createConversation(userId, "Untitled");
    const first = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    await first.text();
    await vi.waitFor(async () => {
      const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
      expect(conversation?.title).toBe("A quiet mock title");
    });

    await renameConversation(id, userId, "A quiet mock title", { customized: false });

    // Deterministic stand-in for "onFinish ran to completion" (no fixed
    // real-time sleep): for a second exchange, the title branch is skipped
    // synchronously right after the AI reply's own save resolves, so flag
    // that moment and wait on the flag instead of guessing at a delay. The
    // real implementation comes from importActual, not getMockImplementation
    // — a prior test's mockImplementationOnce + restoreAllMocks cycle can
    // leave the spy's recorded default implementation slot empty even though
    // its pass-through invocation still works.
    const { saveMessage: realSaveMessage } =
      await vi.importActual<typeof import("@/lib/conversations")>("@/lib/conversations");
    let aiReplyPersisted = false;
    vi.mocked(saveMessage).mockImplementation(async (input) => {
      const result = await realSaveMessage(input);
      if (input.sender === "ai") aiReplyPersisted = true;
      return result;
    });

    const second = await POST(chatRequest({ conversationId: id, text: "Still thinking about it" }));
    await second.text();
    await vi.waitFor(() => {
      expect(aiReplyPersisted).toBe(true);
    });

    const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
    expect(conversation?.title).toBe("A quiet mock title");
    expect(await isTitleCustomized(id, userId)).toBe(false);
  });

  it("keeps the neutral date title when the first exchange is flagged as crisis", async () => {
    const { id } = await createConversation(userId, "July 6");

    // Same deterministic stand-in as the "second exchange" test above: the
    // crisis skip is decided synchronously right after the AI reply's own
    // save resolves.
    const { saveMessage: realSaveMessage } =
      await vi.importActual<typeof import("@/lib/conversations")>("@/lib/conversations");
    let aiReplyPersisted = false;
    vi.mocked(saveMessage).mockImplementation(async (input) => {
      const result = await realSaveMessage(input);
      if (input.sender === "ai") aiReplyPersisted = true;
      return result;
    });

    const res = await POST(chatRequest({ conversationId: id, text: "MOCK_CRISIS I want to hurt myself" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-risk-level")).toBe("crisis");
    await res.text(); // drain the stream so onFinish (and the skipped title call) runs
    await vi.waitFor(() => {
      expect(aiReplyPersisted).toBe(true);
    });

    const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
    expect(conversation?.title).toBe("July 6");
    expect(await isTitleCustomized(id, userId)).toBe(false);
  });

  it("never logs message plaintext carried on a failed auto-title error", async () => {
    const { id } = await createConversation(userId, "Untitled");

    // AI SDK errors carry the request body (the title prompt — message
    // plaintext) as enumerable own properties; the sentinel stands in for it.
    const sentinel = "SENTINEL_PLAINTEXT";
    vi.mocked(getTitleModel).mockReturnValueOnce(
      new MockLanguageModelV3({
        doGenerate: async () => {
          const error = new Error("Bad Request");
          Object.assign(error, { requestBodyValues: { prompt: sentinel }, responseBody: sentinel });
          throw error;
        },
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    await res.text(); // drain the stream so onFinish (and the failing title call) runs

    await vi.waitFor(() => {
      expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("Failed to auto-title"))).toBe(true);
    });
    const logged = errorSpy.mock.calls
      .map((args) => args.map((a) => inspect(a, { depth: 20 })).join(" "))
      .join("\n");
    expect(logged).not.toContain(sentinel);
  });

  it("never overwrites a title the user already customized", async () => {
    const { id } = await createConversation(userId, "Untitled");
    await renameConversation(id, userId, "Mine");

    // Deterministic stand-in for "onFinish's title check ran to completion":
    // here the skip is only decided once isTitleCustomized's own DB read
    // resolves (true, since it was just customized above) — one await later
    // than the AI reply's save — so flag that resolution instead of a fixed
    // real-time sleep.
    const { isTitleCustomized: realIsTitleCustomized } =
      await vi.importActual<typeof import("@/lib/conversations")>("@/lib/conversations");
    let titleCheckResolved = false;
    vi.mocked(isTitleCustomized).mockImplementation(async (conversationIdArg, userIdArg) => {
      const result = await realIsTitleCustomized(conversationIdArg, userIdArg);
      titleCheckResolved = true;
      return result;
    });

    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    await res.text();
    await vi.waitFor(() => {
      expect(titleCheckResolved).toBe(true);
    });

    const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
    expect(conversation?.title).toBe("Mine");
    expect(await isTitleCustomized(id, userId)).toBe(true);
  });

  describe("therapist messages and guidance in the AI's context", () => {
    // Each test below needs its own client — the one-active-link-per-client
    // rule (therapist-links.ts) means the shared module-level `userId` can't
    // carry more than one link across these tests. Overriding the session
    // once per POST call keeps every test's client id isolated (and doesn't
    // touch `userId`'s own rate-limit bucket, which the final test in this
    // file depends on being pristine until it deliberately drains it).
    function mockSession(clientId: string) {
      vi.mocked(auth.api.getSession).mockResolvedValueOnce({
        user: { id: clientId },
      } as Awaited<ReturnType<typeof auth.api.getSession>>);
    }

    it("sends a therapist's intervention to the model as a user-role message with the attribution prefix", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Shared with a therapist");
      const therapistId = await insertUser("Dr. Rivera");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await grantConversation(clientId, id);
      await sendIntervention(therapistId, id, "You mentioned distancing yourself again — let's revisit that.");

      const res = await POST(chatRequest({ conversationId: id, text: "Okay, I've been thinking about it" }));
      await res.text();

      const prompt = lastChatPrompt();
      const therapistTurn = prompt.find(
        (m) => m.role === "user" && JSON.stringify(m.content).includes("distancing yourself"),
      );
      expect(therapistTurn).toBeDefined();
      expect(therapistTurn?.role).toBe("user");
      expect(JSON.stringify(therapistTurn?.content)).toContain(
        "[The client's therapist, Dr. Rivera, wrote:] You mentioned distancing yourself again",
      );

      // Never as assistant — a human's words must never be read back as the AI's own.
      const assistantTurns = prompt.filter((m) => m.role === "assistant");
      expect(assistantTurns.some((m) => JSON.stringify(m.content).includes("distancing yourself"))).toBe(false);
    });

    it("keeps attributing a message to its actual author even after that therapist's link is revoked", async () => {
      // The old bug: attribution followed the CURRENTLY active link, so
      // revoking it (or replacing it) silently relabeled — or blanked — a
      // past therapist's own words. Attribution now travels with the
      // message's authorId, independent of link status.
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Link revoked later");
      const therapistId = await insertUser("Dr. Chen");
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await grantConversation(clientId, id);
      await sendIntervention(therapistId, id, "Let's check in on your sleep.");
      await revokeLink(linkId, clientId);

      const res = await POST(chatRequest({ conversationId: id, text: "Still not sleeping well" }));
      await res.text();

      const prompt = lastChatPrompt();
      const therapistTurn = prompt.find(
        (m) => m.role === "user" && JSON.stringify(m.content).includes("check in on your sleep"),
      );
      expect(JSON.stringify(therapistTurn?.content)).toContain("[The client's therapist, Dr. Chen, wrote:]");
    });

    it("attributes each therapist's messages to themselves, never to whichever therapist is currently linked", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Therapist changed mid-conversation");

      const therapistA = await insertUser("Dr. A");
      const { linkId: linkIdA, token: tokenA } = await createInvite(clientId, "client");
      await acceptInvite(tokenA, therapistA);
      await grantConversation(clientId, id);
      await sendIntervention(therapistA, id, "A's note about pacing yourself.");
      await revokeLink(linkIdA, clientId);

      // A new therapist takes over — this link, not A's, is now active.
      const therapistB = await insertUser("Dr. B");
      const { token: tokenB } = await createInvite(clientId, "client");
      await acceptInvite(tokenB, therapistB);

      const res = await POST(chatRequest({ conversationId: id, text: "Still working on that" }));
      await res.text();

      const prompt = lastChatPrompt();
      const aTurn = prompt.find(
        (m) => m.role === "user" && JSON.stringify(m.content).includes("A's note about pacing"),
      );
      expect(JSON.stringify(aTurn?.content)).toContain("[The client's therapist, Dr. A, wrote:]");
      expect(JSON.stringify(aTurn?.content)).not.toContain("Dr. B");
    });

    it("falls back to 'their therapist' for a legacy therapist message with no recorded author", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Predates the author column");
      // Simulates a row written before the authorId column existed —
      // saveMessage never sets it, so it lands null, same as an untouched
      // legacy row would.
      await saveMessage({ conversationId: id, userId: clientId, sender: "therapist", text: "An old note, no author on file" });

      const res = await POST(chatRequest({ conversationId: id, text: "Following up" }));
      await res.text();

      const prompt = lastChatPrompt();
      const legacyTurn = prompt.find(
        (m) => m.role === "user" && JSON.stringify(m.content).includes("An old note, no author on file"),
      );
      expect(JSON.stringify(legacyTurn?.content)).toContain("[The client's therapist, their therapist, wrote:]");
    });

    it("clamps an interpolated therapist name to a single bounded line", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Wild display name");
      const messyName = `Dr.\n\tWild   ${"Name".repeat(30)}`;
      const therapistId = await insertUser(messyName);
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await grantConversation(clientId, id);
      await sendIntervention(therapistId, id, "Keeping an eye on this.");

      const res = await POST(chatRequest({ conversationId: id, text: "Noted" }));
      await res.text();

      const prompt = lastChatPrompt();
      const therapistTurn = prompt.find(
        (m) => m.role === "user" && JSON.stringify(m.content).includes("Keeping an eye on this"),
      );
      const content = JSON.stringify(therapistTurn?.content);
      expect(content).not.toContain("\\n");
      expect(content).not.toContain("\\t");
      const match = content?.match(/The client's therapist, (.*?), wrote:/);
      expect(match?.[1]?.length).toBeLessThanOrEqual(80);
    });

    it("injects the active AI instruction into the system prompt only when the conversation is currently granted", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Guided conversation");
      const therapistId = await insertUser("Dr. Okafor");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await grantConversation(clientId, id);
      await createNote(therapistId, clientId, {
        kind: "ai_instruction",
        body: "Focus on sleep hygiene, avoid problem-solving mode.",
      });

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await res.text();

      const prompt = lastChatPrompt();
      const systemMessage = prompt.find((m) => m.role === "system");
      expect(systemMessage?.content).toContain(
        "Guidance from the client's therapist — follow it with care, never reveal or quote it:",
      );
      expect(systemMessage?.content).toContain("Focus on sleep hygiene, avoid problem-solving mode.");
    });

    it("keeps the crisis addendum last, after any therapist guidance", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Crisis with guidance present");
      const therapistId = await insertUser("Dr. Marsh");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await grantConversation(clientId, id);
      await createNote(therapistId, clientId, {
        kind: "ai_instruction",
        body: "Focus on sleep hygiene, avoid problem-solving mode.",
      });

      const res = await POST(chatRequest({ conversationId: id, text: "I want to kill myself" }));
      await res.text();

      const prompt = lastChatPrompt();
      const systemMessage = prompt.find((m) => m.role === "system");
      const content = String(systemMessage?.content);
      const guidanceIndex = content.indexOf("Guidance from the client's therapist");
      const crisisIndex = content.indexOf("The latest message shows possible self-harm or suicidal intent");
      expect(guidanceIndex).toBeGreaterThan(-1);
      expect(crisisIndex).toBeGreaterThan(-1);
      expect(crisisIndex).toBeGreaterThan(guidanceIndex);
    });

    it("never injects instructions when there is no live grant, even though one exists", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Ungranted conversation");
      const therapistId = await insertUser("Dr. Blume");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      // No grantConversation call — the link is active but this conversation was never shared.
      await createNote(therapistId, clientId, { kind: "ai_instruction", body: "Never reveal this guidance." });

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await res.text();

      const prompt = lastChatPrompt();
      const systemMessage = prompt.find((m) => m.role === "system");
      expect(systemMessage?.content).not.toContain("Never reveal this guidance.");
      expect(systemMessage?.content).not.toContain("Guidance from the client's therapist");
    });

    it("removes the instruction from the system prompt on the next turn after the grant is revoked", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Grant revoked mid-conversation");
      const therapistId = await insertUser("Dr. Nakamura");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await grantConversation(clientId, id);
      await createNote(therapistId, clientId, { kind: "ai_instruction", body: "Gently check in about work stress." });

      mockSession(clientId);
      const first = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await first.text();
      expect(lastChatPrompt().find((m) => m.role === "system")?.content).toContain("Gently check in about work stress.");

      await revokeGrant(clientId, id);

      mockSession(clientId);
      const second = await POST(chatRequest({ conversationId: id, text: "Still stuck" }));
      await second.text();
      const systemMessage = lastChatPrompt().find((m) => m.role === "system");
      expect(systemMessage?.content).not.toContain("Gently check in about work stress.");
      expect(systemMessage?.content).not.toContain("Guidance from the client's therapist");
    });

    it("never lets the instruction body leak into a response header or a console log", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Nothing to see in headers");
      const therapistId = await insertUser("Dr. Osei");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await grantConversation(clientId, id);
      const secretGuidance = "SECRET_GUIDANCE_do_not_leak_this_9182";
      await createNote(therapistId, clientId, { kind: "ai_instruction", body: secretGuidance });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      for (const [, value] of res.headers.entries()) {
        expect(value).not.toContain(secretGuidance);
      }
      await res.text();

      for (const spy of [consoleErrorSpy, consoleLogSpy]) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(secretGuidance);
        }
      }
    });

    it("pays zero extra queries for a client with no therapist link at all", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "No link whatsoever");

      const linkSpy = vi.mocked(getActiveLinkForClient);
      const grantSpy = vi.mocked(getGrantStateForClient);
      const instructionSpy = vi.mocked(getActiveAiInstruction);
      linkSpy.mockClear();
      grantSpy.mockClear();
      instructionSpy.mockClear();

      const res = await POST(chatRequest({ conversationId: id, text: "Just me here" }));
      await res.text();

      expect(linkSpy).toHaveBeenCalledTimes(1);
      expect(grantSpy).not.toHaveBeenCalled();
      expect(instructionSpy).not.toHaveBeenCalled();
    });
  });

  describe("mood and homework in the AI's context", () => {
    // Each test gets its own client id (one-active-link-per-client rule), and
    // its session is overridden per POST so `userId`'s rate-limit bucket stays
    // pristine for the final drain test — same discipline as the block above.
    function mockSession(clientId: string) {
      vi.mocked(auth.api.getSession).mockResolvedValueOnce({
        user: { id: clientId },
      } as Awaited<ReturnType<typeof auth.api.getSession>>);
    }

    function systemContent(): string {
      return String(lastChatPrompt().find((m) => m.role === "system")?.content);
    }

    it("weaves recent mood check-ins into the system prompt when they exist", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Mood-aware chat");
      await checkInMood(clientId, { score: 2, note: "rough week at work" });

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await res.text();

      const content = systemContent();
      expect(content).toContain("Recent mood check-ins");
      expect(content).toContain("rough week at work");
    });

    it("omits the mood line entirely when there are no check-ins", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "No mood data");

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await res.text();

      expect(systemContent()).not.toContain("Recent mood check-ins");
    });

    it("keeps the crisis addendum after the mood line, never before it", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Crisis with mood present");
      await checkInMood(clientId, { score: 1, note: "very low" });

      const res = await POST(chatRequest({ conversationId: id, text: "MOCK_CRISIS I want to hurt myself" }));
      await res.text();

      const content = systemContent();
      const moodIndex = content.indexOf("Recent mood check-ins");
      const crisisIndex = content.indexOf("The latest message shows possible self-harm or suicidal intent");
      expect(moodIndex).toBeGreaterThan(-1);
      expect(crisisIndex).toBeGreaterThan(-1);
      expect(crisisIndex).toBeGreaterThan(moodIndex);
    });

    it("surfaces active homework in the system prompt but drops closed assignments", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Homework-aware chat");
      const therapistId = await insertUser("Dr. Homework");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "ACTIVE_HOMEWORK track a tense moment" });
      const { id: closedId } = await assignExercise(therapistId, clientId, {
        type: "thought_record",
        instruction: "CLOSED_HOMEWORK already finished",
      });
      await closeExercise(therapistId, closedId);

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await res.text();

      const content = systemContent();
      expect(content).toContain("The client has active homework");
      expect(content).toContain("ACTIVE_HOMEWORK track a tense moment");
      expect(content).not.toContain("CLOSED_HOMEWORK already finished");
    });

    it("orders homework newest-first — the newer assignment's instruction precedes the older one", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Two homework assignments");
      const therapistId = await insertUser("Dr. Sequence");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      // Both active and both under a live link — the only thing separating them
      // is creation order, so the newest-first contract is what decides which
      // instruction the model reads first.
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "OLDER_HOMEWORK assigned first" });
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "NEWER_HOMEWORK assigned second" });

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await res.text();

      const content = systemContent();
      const newerIndex = content.indexOf("NEWER_HOMEWORK assigned second");
      const olderIndex = content.indexOf("OLDER_HOMEWORK assigned first");
      expect(newerIndex).toBeGreaterThan(-1);
      expect(olderIndex).toBeGreaterThan(-1);
      expect(newerIndex).toBeLessThan(olderIndex);
    });

    it("never lets a client's own self-note reach the system prompt, and the route never imports the notes module", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Notes stay out of the prompt");
      // A private self-note is the client's own data, but it is journal
      // material — it must never be fed to the companion as context.
      await createSelfNote(clientId, { body: "SENTINEL-NOTE-9317" });

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await res.text();

      expect(systemContent()).not.toContain("SENTINEL-NOTE-9317");

      // Belt-and-suspenders: the route must not even reach for the notes module.
      // A future edit that adds `import ... from "@/lib/notes"` fails here before
      // it can ever wire a note into the prompt.
      const routeSource = readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
      expect(routeSource).not.toContain("@/lib/notes");
    });

    it("drops homework once its therapist link is revoked — steering dies with the relationship", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Homework after revoke");
      const therapistId = await insertUser("Dr. Gone");
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await assignExercise(therapistId, clientId, {
        type: "thought_record",
        instruction: "REVOKED_HOMEWORK steer me",
      });
      await revokeLink(linkId, clientId);

      const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
      await res.text();

      const content = systemContent();
      // The assignment survives as client data (still on /exercises) but must no
      // longer reach the AI as an active ask.
      expect(content).not.toContain("REVOKED_HOMEWORK steer me");
      expect(content).not.toContain("The client has active homework");
    });

    it("always briefs the thought-record walk-through, even with no homework or therapist", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Standalone walk-through");

      const res = await POST(chatRequest({ conversationId: id, text: "Can you walk me through a thought record?" }));
      await res.text();

      // The standalone law: the same column-by-column protocol is present with
      // no therapist and no assignment at all.
      expect(systemContent()).toContain("one column at a time");
    });

    it("orders the system prompt base < walk-through < mood < homework < guidance < crisis", async () => {
      const clientId = `test-${randomUUID()}`;
      mockSession(clientId);
      const { id } = await createConversation(clientId, "Everything at once");
      const therapistId = await insertUser("Dr. Everything");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await grantConversation(clientId, id);
      await createNote(therapistId, clientId, { kind: "ai_instruction", body: "Focus on sleep hygiene." });
      await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "Notice one worry each night." });
      await checkInMood(clientId, { score: 2, note: "tired" });

      const res = await POST(chatRequest({ conversationId: id, text: "I want to kill myself" }));
      await res.text();

      const content = systemContent();
      const baseIndex = content.indexOf("You are a warm, attentive emotional-support companion");
      const walkthroughIndex = content.indexOf("one column at a time");
      const moodIndex = content.indexOf("Recent mood check-ins");
      const homeworkIndex = content.indexOf("The client has active homework");
      const guidanceIndex = content.indexOf("Guidance from the client's therapist");
      const crisisIndex = content.indexOf("The latest message shows possible self-harm or suicidal intent");

      for (const index of [baseIndex, walkthroughIndex, moodIndex, homeworkIndex, guidanceIndex, crisisIndex]) {
        expect(index).toBeGreaterThan(-1);
      }
      // The always-on walk-through is base material: after the base opener, still
      // before mood/homework/guidance, and always before the crisis addendum.
      expect(baseIndex).toBeLessThan(walkthroughIndex);
      expect(walkthroughIndex).toBeLessThan(moodIndex);
      expect(moodIndex).toBeLessThan(homeworkIndex);
      expect(homeworkIndex).toBeLessThan(guidanceIndex);
      expect(guidanceIndex).toBeLessThan(crisisIndex);
    });
  });

  // Runs last in this file: it drains the shared in-memory bucket for `userId`
  // down to zero, which would make every earlier test in this file see a 429
  // if it ran after this one. Exhausting via the limiter's own API (rather
  // than firing 20 real POSTs) keeps this fast and deterministic — see
  // src/lib/rate-limit.test.ts for the limiter's own consume/refill coverage.
  it("returns 429 once the per-user rate limit bucket is exhausted", async () => {
    const { id } = await createConversation(userId, "Rate limited");
    for (let i = 0; i < 25; i++) chatRateLimiter.consume(userId);

    const res = await POST(chatRequest({ conversationId: id, text: "one more" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Slow down a little" });
  });
});
