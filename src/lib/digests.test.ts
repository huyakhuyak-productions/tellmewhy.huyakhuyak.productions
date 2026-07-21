import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { digests, messages } from "@/db/schema";
import { MOCK_FINISH_REASON, MOCK_USAGE } from "@/test/ai-fixtures";
import { createConversation, saveMessage, setActiveLeaf } from "./conversations";
import { CryptoError, decryptText, encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import { grantConversation, revokeGrant } from "./sharing";
import { acceptInvite, createInvite } from "./therapist-links";
import { getDigestModel } from "./ai/models";
import { getOrRefreshDigest, type DigestBody } from "./digests";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

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

  beforeEach(async () => {
    clientId = await seedUser();
    therapistId = await seedUser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(cleanupSeededUsers);

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

    it("a slow regeneration cannot roll coverage back over a newer digest", async () => {
      const convId = await grantedConversation("CAS");
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "first" });
      const second = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "second" });

      // Generate once: the row now covers `second`.
      await getOrRefreshDigest(therapistId, convId);
      const [beforeRow] = await db.select().from(digests).where(eq(digests.conversationId, convId));
      expect(beforeRow.coversUpToMessageId).toBe(second.id);

      // A new message makes our caller take the regenerate path (it reads the
      // row as covering `second`, then generates over `third`).
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "third" });

      // The winning writer lands BETWEEN our caller's read and its write: the
      // mock's generation step stamps a newer coverage onto the row, exactly as
      // a concurrent regeneration that finished first would have. Our caller's
      // CAS (setWhere on the coverage it read) must then refuse to overwrite.
      const fakeNewer = randomUUID();
      vi.mocked(getDigestModel).mockReturnValueOnce(
        new MockLanguageModelV3({
          doGenerate: async () => {
            await db.update(digests).set({ coversUpToMessageId: fakeNewer }).where(eq(digests.conversationId, convId));
            return {
              finishReason: MOCK_FINISH_REASON,
              usage: MOCK_USAGE,
              content: [{ type: "text", text: JSON.stringify({ overview: "slow", themes: [], anchors: [] }) }],
              warnings: [],
            };
          },
        }),
      );

      await getOrRefreshDigest(therapistId, convId);

      const [afterRow] = await db.select().from(digests).where(eq(digests.conversationId, convId));
      // The stale regeneration did NOT roll the coverage back: the concurrent
      // winner's value survives.
      expect(afterRow.coversUpToMessageId).toBe(fakeNewer);
    });

    it("a cached digest drops anchors whose messages were deleted", async () => {
      const convId = await grantedConversation("Cached anchor drop");
      const anchored = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "anchor me" });
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "newest" });

      // The digest mock anchors the first transcript message → `anchored`.
      const first = await getOrRefreshDigest(therapistId, convId);
      expect(first!.anchors).toEqual([{ messageId: anchored.id, label: "A mock anchor", kind: "moment" }]);

      // Delete the anchored message; the newest is untouched so the stored digest
      // still covers it → the cached path serves without regenerating. Messages
      // now chain via parentId, and the parent_id FK forbids removing a
      // referenced row, so detach the child first — the point is only that the
      // anchored row no longer exists.
      await db.update(messages).set({ parentId: null }).where(eq(messages.parentId, anchored.id));
      await db.delete(messages).where(eq(messages.id, anchored.id));

      const before = vi.mocked(getDigestModel).mock.calls.length;
      const cached = await getOrRefreshDigest(therapistId, convId);
      expect(vi.mocked(getDigestModel).mock.calls.length).toBe(before);
      expect(cached!.stale).toBe(false);
      // The dangling anchor never reaches the therapist.
      expect(cached!.anchors).toEqual([]);
    });

    it("a stale-fallback digest drops anchors whose messages were deleted", async () => {
      const convId = await grantedConversation("Stale anchor drop");
      const anchored = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "anchor me" });
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "second" });

      const first = await getOrRefreshDigest(therapistId, convId);
      expect(first!.anchors).toEqual([{ messageId: anchored.id, label: "A mock anchor", kind: "moment" }]);

      // The anchored message is deleted and a new one arrives → the cache is
      // stale and regeneration runs. Force it to fail so we fall back to the
      // prior body, which still carries the now-dangling anchor. Detach the
      // child first so the parent_id FK permits removing the anchored row.
      await db.update(messages).set({ parentId: null }).where(eq(messages.parentId, anchored.id));
      await db.delete(messages).where(eq(messages.id, anchored.id));
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "third" });
      vi.mocked(getDigestModel).mockReturnValueOnce(throwingDigestModel());

      const stale = await getOrRefreshDigest(therapistId, convId);
      expect(stale!.stale).toBe(true);
      // Stale body is served, but the deleted anchor is filtered out.
      expect(stale!.anchors).toEqual([]);
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

  describe("path-aware (branches)", () => {
    it("summarizes only the ACTIVE PATH — a superseded branch's words never reach the prompt", async () => {
      const convId = await grantedConversation("Path-only transcript");
      const m1 = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "PATH_ROOT" });
      // A superseded branch off m1, with distinctive text, then the active branch.
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "SUPERSEDED_BRANCH_SECRET", parentId: m1.id });
      await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "ACTIVE_BRANCH_TEXT", parentId: m1.id });

      await getOrRefreshDigest(therapistId, convId);
      const prompt = lastDigestPrompt();
      expect(prompt).toContain("ACTIVE_BRANCH_TEXT");
      expect(prompt).toContain("PATH_ROOT");
      // The off-path branch is invisible to the model.
      expect(prompt).not.toContain("SUPERSEDED_BRANCH_SECRET");
    });

    it("goes stale when the active leaf moves, even though no message rows changed", async () => {
      const convId = await grantedConversation("Leaf-move staleness");
      const m1 = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "root" });
      const branchA = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "branch A", parentId: m1.id });
      const branchB = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "branch B", parentId: m1.id });

      // Cover the current path (leaf = branchB, the latest child of m1).
      const first = await getOrRefreshDigest(therapistId, convId);
      expect(first!.coversUpToMessageId).toBe(branchB.id);

      // No rows added or removed — only the active leaf moves to branchA.
      await setActiveLeaf(convId, clientId, branchA.id);

      const before = vi.mocked(getDigestModel).mock.calls.length;
      const refreshed = await getOrRefreshDigest(therapistId, convId);
      // A leaf move alone must trigger regeneration: the covered leaf changed.
      expect(vi.mocked(getDigestModel).mock.calls.length).toBe(before + 1);
      expect(refreshed!.coversUpToMessageId).toBe(branchA.id);
      expect(refreshed!.stale).toBe(false);
    });

    it("drops an anchor pointing at a message on a superseded branch (path-scoped validMessageIds)", async () => {
      const convId = await grantedConversation("Off-path anchor");
      const m1 = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "root" });
      const superseded = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "superseded", parentId: m1.id });
      const active = await saveMessage({ conversationId: convId, userId: clientId, sender: "client", text: "active", parentId: m1.id });
      // Make branchA (superseded) the active leaf so `active` is off-path.
      await setActiveLeaf(convId, clientId, superseded.id);

      // The model anchors an off-path message (`active`) and an on-path one (m1).
      vi.mocked(getDigestModel).mockReturnValueOnce(
        digestModelReturning({
          overview: "overview",
          themes: ["theme"],
          anchors: [
            { messageId: active.id, label: "off-path", kind: "moment" },
            { messageId: m1.id, label: "on-path root", kind: "moment" },
          ],
        }),
      );

      const digest = await getOrRefreshDigest(therapistId, convId);
      // Only the on-path anchor survives; the off-path branch anchor is scrubbed
      // by the path-scoped validMessageIds — not merely the whole-conversation set.
      expect(digest!.anchors).toEqual([{ messageId: m1.id, label: "on-path root", kind: "moment" }]);
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
