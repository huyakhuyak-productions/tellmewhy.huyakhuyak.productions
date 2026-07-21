import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { MOCK_FINISH_REASON, MOCK_USAGE } from "@/test/ai-fixtures";
import { TITLE_MAX_OUTPUT_TOKENS } from "@/lib/title";
import { createConversation, isTitleCustomized, listConversations, loadMessages, loadMessageTree, renameConversation, saveMessage } from "@/lib/conversations";
import { getKeyProvider } from "@/lib/crypto/key-provider";
import chatRateLimiter from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, user } from "@/db/schema";
import { acceptInvite, createInvite, getActiveLinkForClient, revokeLink } from "@/lib/therapist-links";
import { getGrantStateForClient, grantConversation, revokeGrant } from "@/lib/sharing";
import { createNote, getActiveAiInstruction } from "@/lib/therapist-notes";
import { createNote as createSelfNote } from "@/lib/notes";
import { sendIntervention } from "@/lib/interventions";
import { assignExercise, closeExercise } from "@/lib/exercises";
import { checkInMood } from "@/lib/mood";
import { getChatModel, getClassifierModel, getTitleModel } from "@/lib/ai/models";

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
    const call = consoleErrorSpy.mock.calls[0]!;
    // Ids + errorCause(error) only — a single string, never a second raw
    // error-object argument.
    expect(call).toHaveLength(1);
    expect(call[0]).toContain(id);
    expect(call[0]).toContain("simulated persistence failure");

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

  // Pins the budget EXACTLY. Uncapped (the production bug), the provider
  // reserves the model's whole 65535-token window and OpenRouter rejects the
  // call, leaving the composer's placeholder date as the title. Capped too
  // tightly, a reasoning model spends the budget on thinking tokens and
  // returns empty text — same visible symptom. Asserting one side only would
  // let the other regression through.
  it("reserves exactly the title call's output budget — neither uncapped nor starved", async () => {
    const { id } = await createConversation(userId, "Untitled");
    let seen: number | undefined;
    // Waited on instead of `seen` itself: pre-fix `seen` is assigned
    // undefined, so waiting on its definedness fails by timeout with a
    // misleading message rather than by assertion.
    let titleCallMade = false;
    vi.mocked(getTitleModel).mockReturnValueOnce(
      new MockLanguageModelV3({
        doGenerate: async (options) => {
          seen = options.maxOutputTokens;
          titleCallMade = true;
          return {
            finishReason: MOCK_FINISH_REASON,
            usage: MOCK_USAGE,
            content: [{ type: "text", text: "A quiet mock title" }],
            warnings: [],
          };
        },
      }),
    );

    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    await res.text(); // drain the stream so onFinish (and the title call) runs

    await vi.waitFor(() => {
      expect(titleCallMade).toBe(true);
    });
    expect(seen).toBe(TITLE_MAX_OUTPUT_TOKENS);
    expect(TITLE_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(64);
  });

  // The empty-completion twin of the outage above: a model that answers with
  // nothing leaves the date placeholder in place, and without this log that
  // is indistinguishable from working correctly.
  it("logs when the model returns no usable title, rather than silently keeping the date", async () => {
    const { id } = await createConversation(userId, "July 6");
    vi.mocked(getTitleModel).mockReturnValueOnce(
      new MockLanguageModelV3({
        doGenerate: async () => ({
          finishReason: MOCK_FINISH_REASON,
          usage: MOCK_USAGE,
          content: [{ type: "text", text: "   " }], // whitespace clamps to nothing
          warnings: [],
        }),
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(chatRequest({ conversationId: id, text: "I feel stuck" }));
    await res.text();

    await vi.waitFor(() => {
      expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("no usable title"))).toBe(true);
    });
    // ...and the conversation keeps its placeholder rather than being renamed
    // to an empty string.
    const [conversation] = (await listConversations(userId)).filter((c) => c.id === id);
    expect(conversation?.title).toBe("July 6");
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

  describe("branch sends, regenerate, and honest stop", () => {
    // Fresh client per test (same discipline as the blocks above): keeps the
    // shared `userId` rate-limit bucket pristine for the final drain test, and
    // gives every tree its own conversation-owning user.
    function mockSession(clientId: string) {
      vi.mocked(auth.api.getSession).mockResolvedValueOnce({
        user: { id: clientId },
      } as Awaited<ReturnType<typeof auth.api.getSession>>);
    }

    // POST one chat body and wait until its persistence settles: +2 rows for a
    // send (client turn + AI reply), +1 for a regenerate (AI reply only).
    // Sequential seeds NEED this — an append chains off the active leaf, so
    // firing the next send before the AI reply lands would misparent it.
    async function postAndAwaitReply(clientId: string, body: { conversationId: string } & Record<string, unknown>) {
      const before = (await loadMessageTree(body.conversationId, clientId)).messages.length;
      mockSession(clientId);
      const res = await POST(chatRequest(body));
      expect(res.status).toBe(200);
      await res.text(); // drain the stream so onFinish persistence runs
      const expected = before + ("regenerateOf" in body ? 1 : 2);
      await vi.waitFor(async () => {
        expect((await loadMessageTree(body.conversationId, clientId)).messages.length).toBe(expected);
      });
      return loadMessageTree(body.conversationId, clientId);
    }

    it("an edit branches: the new client message is a sibling of the edited one", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Branching edit");
      await postAndAwaitReply(clientId, { conversationId: id, text: "first thought" });
      await postAndAwaitReply(clientId, { conversationId: id, text: "second thought" });

      const path = await loadMessages(id, clientId);
      expect(path.map((m) => m.sender)).toEqual(["client", "ai", "client", "ai"]);
      const [, r1, m2, r2] = path;

      // Edit m2: branch at ITS parent (r1), so the edit is m2's sibling.
      const tree = await postAndAwaitReply(clientId, {
        conversationId: id,
        text: "second thought, edited",
        parentId: m2.parentId,
      });

      const edited = tree.messages.find((m) => m.text === "second thought, edited");
      expect(edited?.parentId).toBe(r1.id);
      const newReply = tree.messages.find((m) => m.parentId === edited?.id);
      expect(newReply?.sender).toBe("ai");
      expect(tree.activeLeafId).toBe(newReply?.id);

      // The superseded version and its reply survive — an edit hides, never deletes.
      const ids = tree.messages.map((m) => m.id);
      expect(ids).toContain(m2.id);
      expect(ids).toContain(r2.id);
    });

    it("regenerate creates an AI sibling and moves the leaf", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Regenerated reply");
      await postAndAwaitReply(clientId, { conversationId: id, text: "tell me why" });
      const [m1, r1] = await loadMessages(id, clientId);

      const classifierSpy = vi.mocked(getClassifierModel);
      classifierSpy.mockClear();
      const tree = await postAndAwaitReply(clientId, { conversationId: id, regenerateOf: r1.id });

      // Two AI versions now hang under the same client message; the leaf is the new one.
      const aiSiblings = tree.messages.filter((m) => m.parentId === m1.id && m.sender === "ai");
      expect(aiSiblings).toHaveLength(2);
      const newReply = aiSiblings.find((m) => m.id !== r1.id);
      expect(tree.activeLeafId).toBe(newReply?.id);
      expect((await loadMessages(id, clientId)).map((m) => m.id)).toEqual([m1.id, newReply?.id]);

      // No client message was saved, and no risk classification ran — there
      // is no new client text to classify.
      expect(tree.messages.filter((m) => m.sender === "client")).toHaveLength(1);
      expect(classifierSpy).not.toHaveBeenCalled();

      // The model's context ends at the parent client turn: the regenerated-away
      // reply must not steer its own replacement.
      const promptJson = JSON.stringify(lastChatPrompt());
      expect(promptJson).toContain("tell me why");
      expect(promptJson).not.toContain("mock reply");
    });

    it("regenerateOf rejects a non-AI or foreign message with 404", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Regenerate misuse");
      await postAndAwaitReply(clientId, { conversationId: id, text: "hello" });
      const [m1] = await loadMessages(id, clientId);

      // A client message cannot be regenerated.
      mockSession(clientId);
      const nonAi = await POST(chatRequest({ conversationId: id, regenerateOf: m1.id }));
      expect(nonAi.status).toBe(404);

      // Another user's AI message id answers the same uniform 404 — no
      // existence oracle across ownership boundaries.
      const strangerId = `test-${randomUUID()}`;
      const foreign = await createConversation(strangerId, "Not yours");
      await saveMessage({ conversationId: foreign.id, userId: strangerId, sender: "ai", text: "foreign reply" });
      const [foreignAi] = await loadMessages(foreign.id, strangerId);
      mockSession(clientId);
      const foreignRes = await POST(chatRequest({ conversationId: id, regenerateOf: foreignAi.id }));
      expect(foreignRes.status).toBe(404);
    });

    it("aborting the stream persists exactly the streamed prefix", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Stopped mid-reply");

      const FULL_REPLY_CHUNKS = ["The ", "river ", "keeps ", "moving ", "even ", "when ", "you ", "rest."];
      const STREAMED_COUNT = 3;
      const fullReply = FULL_REPLY_CHUNKS.join("");
      vi.mocked(getChatModel).mockReturnValueOnce(
        new MockLanguageModelV3({
          doStream: async ({ abortSignal }) => ({
            stream: new ReadableStream({
              async start(controller) {
                controller.enqueue({ type: "text-start", id: "1" });
                for (const delta of FULL_REPLY_CHUNKS.slice(0, STREAMED_COUNT)) {
                  controller.enqueue({ type: "text-delta", id: "1", delta });
                }
                // Hold the rest of the reply hostage until the request aborts.
                // Deterministic by construction: the full reply can never be
                // produced, so whatever gets persisted MUST be the streamed
                // prefix — no sleep-based racing. If the route fails to wire
                // req.signal through to the model, this never resolves and the
                // waitFor below times out: an honest failure.
                await new Promise<void>((resolve) => {
                  if (abortSignal?.aborted) return resolve();
                  abortSignal?.addEventListener("abort", () => resolve(), { once: true });
                });
                controller.error(new DOMException("The stream was aborted", "AbortError"));
              },
            }),
          }),
        }),
      );

      mockSession(clientId);
      const controller = new AbortController();
      const res = await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: id, text: "keep going" }),
          signal: controller.signal,
        }),
      );
      expect(res.status).toBe(200);

      // Read until the streamed prefix has actually reached the client, then
      // stop the request — exactly what the Stop button does.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let seen = "";
      while (!seen.includes("keeps ")) {
        const { done, value } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
      }
      controller.abort();
      // Drain the tail (the abort part closes the stream cleanly) so the
      // pipeline settles and onFinish can run.
      try {
        while (!(await reader.read()).done) {
          /* drain */
        }
      } catch {
        // an errored tail is fine — the abort already happened
      }

      await vi.waitFor(async () => {
        const ai = (await loadMessages(id, clientId)).find((m) => m.sender === "ai");
        expect(ai).toBeDefined();
        // A strict non-empty prefix: honest partial, never a fake whole.
        expect(ai!.text.length).toBeGreaterThan(0);
        expect(ai!.text.length).toBeLessThan(fullReply.length);
        expect(fullReply.startsWith(ai!.text)).toBe(true);
      });
    });

    it("regenerating a crisis-flagged turn reuses its stored risk — addendum and header both crisis, no re-classification", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Crisis regenerate");
      // MOCK_CRISIS flags via the classifier (not the regex floor) so the
      // stored risk on the client row is genuinely "crisis".
      await postAndAwaitReply(clientId, { conversationId: id, text: "MOCK_CRISIS I can't keep going" });
      const [m1, r1] = await loadMessages(id, clientId);
      expect(m1.riskLevel).toBe("crisis");

      const classifierSpy = vi.mocked(getClassifierModel);
      classifierSpy.mockClear();
      mockSession(clientId);
      const res = await POST(chatRequest({ conversationId: id, regenerateOf: r1.id }));
      // The regenerated reply carries the parent turn's risk through the header…
      expect(res.headers.get("x-risk-level")).toBe("crisis");
      await res.text();

      // …and the crisis addendum is still the LAST thing the model reads.
      const content = String(lastChatPrompt().find((m) => m.role === "system")?.content);
      expect(content).toContain("The latest message shows possible self-harm or suicidal intent");
      expect(content.trimEnd().endsWith("gently encourage immediate real-world support.")).toBe(true);

      // Reuse, not re-run: regenerate never invokes the classifier.
      expect(classifierSpy).not.toHaveBeenCalled();
    });

    it("regenerating a crisis turn keeps its crisis flag even when the parent body won't decrypt", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Corrupt crisis parent");
      await postAndAwaitReply(clientId, { conversationId: id, text: "MOCK_CRISIS I can't keep going" });
      const [m1, r1] = await loadMessages(id, clientId);
      expect(m1.riskLevel).toBe("crisis");

      // Corrupt the parent client message's ciphertext so its body can no longer
      // decrypt — it drops out of the decrypted tree entirely. The stored risk
      // level lives on the RAW row (a plaintext column), so the crisis signal
      // must still survive: the x-risk-level header is what raises the client's
      // crisis banner, and safety can't hinge on a body that failed to decrypt.
      await db.update(messages).set({ ciphertext: "not-valid-ciphertext" }).where(eq(messages.id, m1.id));

      mockSession(clientId);
      const res = await POST(chatRequest({ conversationId: id, regenerateOf: r1.id }));
      expect(res.headers.get("x-risk-level")).toBe("crisis");
      await res.text();
    });

    it("regenerating a normal turn stays none — no crisis addendum, header none", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Normal regenerate");
      await postAndAwaitReply(clientId, { conversationId: id, text: "just an ordinary thought" });
      const [m1, r1] = await loadMessages(id, clientId);
      expect(m1.riskLevel).toBe("none");

      mockSession(clientId);
      const res = await POST(chatRequest({ conversationId: id, regenerateOf: r1.id }));
      expect(res.headers.get("x-risk-level")).toBe("none");
      await res.text();

      const content = String(lastChatPrompt().find((m) => m.role === "system")?.content);
      expect(content).not.toContain("The latest message shows possible self-harm or suicidal intent");
    });

    it("an edit with a foreign/nonexistent parentId is a route-level 404", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Edit misparent");
      await postAndAwaitReply(clientId, { conversationId: id, text: "a real turn" });

      // A parent that belongs to no message of this conversation (here, a fresh
      // random uuid) is indistinguishable from "not found" to the client.
      mockSession(clientId);
      const res = await POST(chatRequest({ conversationId: id, text: "edit onto nowhere", parentId: randomUUID() }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    });

    it("a root edit (parentId: null) collapses history to one message and DELIBERATELY re-titles when uncustomized", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "July 6");
      // First exchange auto-titles (uncustomized).
      await postAndAwaitReply(clientId, { conversationId: id, text: "first thought" });
      await vi.waitFor(async () => {
        const [conversation] = (await listConversations(clientId)).filter((c) => c.id === id);
        expect(conversation?.title).toBe("A quiet mock title");
      });
      // Move the title away, still marked uncustomized — so a re-title is
      // observable (the mock always regenerates "A quiet mock title").
      await renameConversation(id, clientId, "A placeholder", { customized: false });

      // A root edit branches at the root, so the active path is just this one
      // new client message → history.length === 1 again.
      await postAndAwaitReply(clientId, { conversationId: id, text: "root edit thought", parentId: null });

      await vi.waitFor(async () => {
        const [conversation] = (await listConversations(clientId)).filter((c) => c.id === id);
        expect(conversation?.title).toBe("A quiet mock title");
      });
      expect(await isTitleCustomized(id, clientId)).toBe(false);
    });

    it("a first exchange whose stream ends in a model error keeps its neutral title (partial still persisted)", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "July 6");

      // The stream closes cleanly (so onFinish runs), but the model reports it
      // finished in error — a truncated reply. onFinish sees finishReason
      // "error" with the streamed prefix already accumulated.
      vi.mocked(getChatModel).mockReturnValueOnce(
        new MockLanguageModelV3({
          doStream: async () => ({
            stream: simulateReadableStream({
              chunks: [
                { type: "text-start", id: "1" },
                { type: "text-delta", id: "1", delta: "half a thought" },
                { type: "text-end", id: "1" },
                { type: "finish", finishReason: { unified: "error", raw: "error" }, usage: MOCK_USAGE },
              ],
            }),
          }),
        }),
      );

      mockSession(clientId);
      const res = await POST(chatRequest({ conversationId: id, text: "first thought" }));
      expect(res.status).toBe(200);
      await res.text(); // drain so onFinish runs

      // The honest partial is still persisted…
      await vi.waitFor(async () => {
        const ai = (await loadMessages(id, clientId)).find((m) => m.sender === "ai");
        expect(ai?.text).toBe("half a thought");
      });
      // …but a title generated from a truncated first exchange is misleading, so
      // the neutral date title stays put.
      const [conversation] = (await listConversations(clientId)).filter((c) => c.id === id);
      expect(conversation?.title).toBe("July 6");
    });

    it("the AI context is the ACTIVE PATH, not the whole tree", async () => {
      const clientId = `test-${randomUUID()}`;
      const { id } = await createConversation(clientId, "Branch-aware context");
      await postAndAwaitReply(clientId, { conversationId: id, text: "original first" });
      await postAndAwaitReply(clientId, { conversationId: id, text: "SUPERSEDED_BRANCH original second" });
      const [, , m2] = await loadMessages(id, clientId);

      await postAndAwaitReply(clientId, { conversationId: id, text: "edited second", parentId: m2.parentId });
      await postAndAwaitReply(clientId, { conversationId: id, text: "and a follow-up" });

      const promptJson = JSON.stringify(lastChatPrompt());
      expect(promptJson).toContain("original first");
      expect(promptJson).toContain("edited second");
      expect(promptJson).toContain("and a follow-up");
      expect(promptJson).not.toContain("SUPERSEDED_BRANCH");
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
