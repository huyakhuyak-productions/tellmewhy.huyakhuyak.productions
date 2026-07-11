import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { digests, messages } from "@/db/schema";
import { MOCK_FINISH_REASON, MOCK_USAGE } from "@/test/ai-fixtures";
import { createConversation, saveMessage } from "./conversations";
import { CryptoError, decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import { grantConversation, revokeGrant } from "./sharing";
import { acceptInvite, createInvite } from "./therapist-links";
import { getDigestModel } from "./ai/models";
import { getOrRefreshDigest, type DigestBody } from "./digests";

// Spy-mode keeps the real getDigestModel (returns the AI_MOCK model) by
// default; individual tests override a single call to inject a hallucinating
// or failing model, or read the prompt the model actually received.
vi.mock("./ai/models", { spy: true });

function digestModelReturning(body: unknown): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: MOCK_FINISH_REASON,
      usage: MOCK_USAGE,
      content: [{ type: "text", text: JSON.stringify(body) }],
      warnings: [],
    }),
  });
}

function throwingDigestModel(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error("model boom");
    },
  });
}

// AI SDK errors (APICallError, NoObjectGeneratedError) carry the request
// body / generated text as enumerable own properties — exactly the shape a
// real OpenRouter failure would have. The sentinel stands in for decrypted
// client plaintext embedded in the prompt.
function payloadCarryingFailureModel(sentinel: string): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const error = new Error("Bad Request");
      Object.assign(error, {
        requestBodyValues: { prompt: sentinel },
        text: sentinel,
        responseBody: sentinel,
      });
      throw error;
    },
  });
}

function lastDigestPrompt(): string {
  const results = vi.mocked(getDigestModel).mock.results;
  const model = results.at(-1)!.value as MockLanguageModelV3;
  return JSON.stringify(model.doGenerateCalls.at(-1)!.prompt);
}

describe("digests — get-or-refresh behind the gate", () => {
  let clientId: string;
  let therapistId: string;

  beforeEach(() => {
    clientId = `test-${randomUUID()}`;
    therapistId = `test-${randomUUID()}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function link() {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
  }

  async function grantedConversation(title = "Shared"): Promise<string> {
    await link();
    const conv = await createConversation(clientId, title);
    await grantConversation(clientId, conv.id);
    return conv.id;
  }

  describe("adversarial", () => {
    it("refuses an ungranted conversation and creates no digest row", async () => {
      await link();
      const conv = await createConversation(clientId, "Never shared");
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });

      await expect(getOrRefreshDigest(therapistId, conv.id)).rejects.toThrow(NotFoundError);

      const rows = await db.select().from(digests).where(eq(digests.conversationId, conv.id));
      expect(rows).toHaveLength(0);
    });

    it("refuses after revocation even when a digest row already exists", async () => {
      const convId = await grantedConversation("Granted then revoked");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "hi" });
      await getOrRefreshDigest(therapistId, convId);
      expect(await db.select().from(digests).where(eq(digests.conversationId, convId))).toHaveLength(1);

      await revokeGrant(clientId, convId);
      await expect(getOrRefreshDigest(therapistId, convId)).rejects.toThrow(NotFoundError);
    });

    it("refuses a foreign therapist", async () => {
      const convId = await grantedConversation("Real therapist only");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "hi" });

      const foreign = `test-${randomUUID()}`;
      await expect(getOrRefreshDigest(foreign, convId)).rejects.toThrow(NotFoundError);
    });

    it("drops anchors whose messageId does not belong to the conversation", async () => {
      const convId = await grantedConversation("Hallucinated anchor");
      const real = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "I felt low today" });

      vi.mocked(getDigestModel).mockReturnValueOnce(
        digestModelReturning({
          overview: "overview",
          themes: ["theme"],
          anchors: [
            { messageId: randomUUID(), label: "fabricated", kind: "risk" },
            { messageId: real.id, label: "real moment", kind: "moment" },
          ],
        }),
      );

      const digest = await getOrRefreshDigest(therapistId, convId);
      expect(digest).not.toBeNull();
      expect(digest!.anchors).toEqual([{ messageId: real.id, label: "real moment", kind: "moment" }]);
    });

    it("stores the body under the client's DEK — the therapist's key cannot read it", async () => {
      const convId = await grantedConversation("Client-key body");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "secret thoughts" });
      await getOrRefreshDigest(therapistId, convId);

      const [row] = await db.select().from(digests).where(eq(digests.conversationId, convId));
      const clientDek = await getOrCreateUserDek(clientId);
      const therapistDek = await getOrCreateUserDek(therapistId);

      const body = JSON.parse(decryptText(clientDek, row.bodyCiphertext)) as DigestBody;
      expect(body.overview).toBe("A mock digest overview.");
      expect(() => decryptText(therapistDek, row.bodyCiphertext)).toThrow(CryptoError);
    });

    it("regenerates when a new message arrives, and serves cache when nothing changed", async () => {
      const convId = await grantedConversation("Staleness");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "first" });

      const before1 = vi.mocked(getDigestModel).mock.calls.length;
      const first = await getOrRefreshDigest(therapistId, convId);
      expect(vi.mocked(getDigestModel).mock.calls.length).toBe(before1 + 1);
      expect(first!.stale).toBe(false);

      // No new message → cached, no model call.
      const before2 = vi.mocked(getDigestModel).mock.calls.length;
      const cached = await getOrRefreshDigest(therapistId, convId);
      expect(vi.mocked(getDigestModel).mock.calls.length).toBe(before2);
      expect(cached!.stale).toBe(false);

      // New message → regenerate, one more model call.
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "second" });
      const before3 = vi.mocked(getDigestModel).mock.calls.length;
      const refreshed = await getOrRefreshDigest(therapistId, convId);
      expect(vi.mocked(getDigestModel).mock.calls.length).toBe(before3 + 1);
      expect(refreshed!.stale).toBe(false);
    });

    it("returns the prior digest marked stale when regeneration fails", async () => {
      const convId = await grantedConversation("Failure with prior");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "first" });
      await getOrRefreshDigest(therapistId, convId);

      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "second" });
      vi.mocked(getDigestModel).mockReturnValueOnce(throwingDigestModel());

      const stale = await getOrRefreshDigest(therapistId, convId);
      expect(stale).not.toBeNull();
      expect(stale!.stale).toBe(true);
      expect(stale!.overview).toBe("A mock digest overview.");
    });

    it("never logs client plaintext carried on a failed generation error", async () => {
      const convId = await grantedConversation("Leaky error");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "private words" });

      const sentinel = "SENTINEL_PLAINTEXT";
      vi.mocked(getDigestModel).mockReturnValueOnce(payloadCarryingFailureModel(sentinel));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await getOrRefreshDigest(therapistId, convId);

      // Serialize every logged argument the way console.error would render it
      // (util.inspect, deep) — the sentinel must appear nowhere in the logs.
      const logged = errorSpy.mock.calls
        .map((args) => args.map((a) => inspect(a, { depth: 20 })).join(" "))
        .join("\n");
      expect(errorSpy).toHaveBeenCalled();
      expect(logged).not.toContain(sentinel);
    });

    it("returns null when generation fails and there is no prior digest, creating no row", async () => {
      const convId = await grantedConversation("Failure with none");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "first" });
      vi.mocked(getDigestModel).mockReturnValueOnce(throwingDigestModel());

      const result = await getOrRefreshDigest(therapistId, convId);
      expect(result).toBeNull();
      expect(await db.select().from(digests).where(eq(digests.conversationId, convId))).toHaveLength(0);
    });

    it("returns null for a granted conversation with no messages, creating no row", async () => {
      const convId = await grantedConversation("Empty");
      const result = await getOrRefreshDigest(therapistId, convId);
      expect(result).toBeNull();
      expect(await db.select().from(digests).where(eq(digests.conversationId, convId))).toHaveLength(0);
    });

    it("clamps each message to 500 chars in the transcript", async () => {
      const convId = await grantedConversation("Clamp");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "Z".repeat(600) });

      await getOrRefreshDigest(therapistId, convId);
      const prompt = lastDigestPrompt();
      expect(prompt).toContain("Z".repeat(500));
      expect(prompt).not.toContain("Z".repeat(501));
    });

    it("windows the transcript to the most recent 200 messages", async () => {
      const convId = await grantedConversation("Window");
      const dek = await getOrCreateUserDek(clientId);
      const base = Date.now();
      const texts: string[] = [];
      for (let i = 0; i < 205; i++) {
        texts.push(i === 0 ? "OLDEST_MARKER_0" : i === 204 ? "NEWEST_MARKER_204" : `msg ${i}`);
      }
      await db.insert(messages).values(
        texts.map((t, i) => ({
          conversationId: convId,
          sender: "client" as const,
          ciphertext: encryptText(dek, t),
          createdAt: new Date(base + i * 1000),
        })),
      );

      await getOrRefreshDigest(therapistId, convId);
      const prompt = lastDigestPrompt();
      expect(prompt).toContain("NEWEST_MARKER_204");
      expect(prompt).not.toContain("OLDEST_MARKER_0");
    });
  });

  describe("happy path", () => {
    it("generates a fresh digest covering the newest message", async () => {
      const convId = await grantedConversation("Fresh");
      const first = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "one" });
      const newest = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "two" });

      const digest = await getOrRefreshDigest(therapistId, convId);
      expect(digest).not.toBeNull();
      expect(digest!.overview).toBe("A mock digest overview.");
      expect(digest!.themes).toEqual(["mock theme"]);
      // The AI_MOCK digest echoes the first transcript message id as an
      // anchor; being a real message of this conversation, it passes the
      // hallucination filter and reaches the therapist intact.
      expect(digest!.anchors).toEqual([{ messageId: first.id, label: "A mock anchor", kind: "moment" }]);
      expect(digest!.coversUpToMessageId).toBe(newest.id);
      expect(digest!.stale).toBe(false);
    });
  });
});
