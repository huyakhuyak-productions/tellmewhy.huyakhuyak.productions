import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { payloadCarryingFailureModel, truncatedObjectModel } from "@/test/ai-fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { exerciseEntries } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createConversation, saveMessage } from "@/lib/conversations";
import { getExtractorModel } from "@/lib/ai/models";
import chatRateLimiter from "@/lib/rate-limit";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

const userId = `test-${randomUUID()}`;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: userId } })) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Spied so a single failure test can swap the extractor model for a throwing
// one without disturbing the AI_MOCK default the happy-path tests rely on.
vi.mock("@/lib/ai/models", { spy: true });

import { POST } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
});
afterEach(cleanupSeededUsers);

function mockSession(clientId: string) {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce({
    user: { id: clientId },
  } as Awaited<ReturnType<typeof auth.api.getSession>>);
}

function extractRequest(body: unknown) {
  return new Request("http://localhost/api/exercises/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/exercises/extract", () => {
  it("returns the extracted thought-record payload for the conversation's owner", async () => {
    const clientId = await seedUser();
    mockSession(clientId);
    const { id } = await createConversation(clientId, "A hard morning");
    await saveMessage({ conversationId: id, userId: clientId, sender: "client", text: "I froze in the standup again" });
    await saveMessage({ conversationId: id, userId: clientId, sender: "ai", text: "That sounds stressful — what went through your mind?" });

    const res = await POST(extractRequest({ conversationId: id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      situation: "Mock situation",
      thoughts: "Mock thoughts",
      emotions: "Mock emotions",
      behavior: "Mock behavior",
    });
  });

  it("persists nothing — the entries table stays empty after extraction", async () => {
    const clientId = await seedUser();
    mockSession(clientId);
    const { id } = await createConversation(clientId, "Nothing saved");
    await saveMessage({ conversationId: id, userId: clientId, sender: "client", text: "I keep avoiding the gym" });

    const res = await POST(extractRequest({ conversationId: id }));
    expect(res.status).toBe(200);
    await res.json();

    const rows = await db.select().from(exerciseEntries).where(eq(exerciseEntries.userId, clientId));
    expect(rows).toEqual([]);
  });

  it("returns 404 for a conversation the caller does not own", async () => {
    const foreignOwner = await seedUser();
    const foreign = await createConversation(foreignOwner, "Not yours");
    const res = await POST(extractRequest({ conversationId: foreign.id }));
    expect(res.status).toBe(404);
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
    const res = await POST(extractRequest({ conversationId: randomUUID() }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed body", async () => {
    const clientId = `test-${randomUUID()}`;
    mockSession(clientId);
    const res = await POST(extractRequest({ conversationId: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("returns 502 without logging message plaintext when the model fails", async () => {
    const clientId = await seedUser();
    mockSession(clientId);
    const { id } = await createConversation(clientId, "Model hiccup");
    const sentinel = "SENTINEL_TRANSCRIPT_PLAINTEXT";
    await saveMessage({ conversationId: id, userId: clientId, sender: "client", text: sentinel });

    // AI SDK errors carry the request body (the transcript) as enumerable own
    // properties — the sentinel stands in for it.
    vi.mocked(getExtractorModel).mockReturnValueOnce(payloadCarryingFailureModel(sentinel, "Bad Gateway"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(extractRequest({ conversationId: id }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not extract an entry" });

    const logged = errorSpy.mock.calls.map((args) => args.map((a) => inspect(a, { depth: 20 })).join(" ")).join("\n");
    expect(logged).not.toContain(sentinel);
  });

  it("returns 502 when the model's completion is truncated (non-stop finish)", async () => {
    const clientId = await seedUser();
    mockSession(clientId);
    const { id } = await createConversation(clientId, "Truncated draft");
    await saveMessage({ conversationId: id, userId: clientId, sender: "client", text: "I froze again" });

    // A well-formed record, but the model ran out of budget mid-object: v6's
    // Output.object returns an undefined object instead of throwing, and the
    // route must surface that as a 502 rather than send back a partial draft.
    vi.mocked(getExtractorModel).mockReturnValueOnce(
      truncatedObjectModel({
        situation: "half",
        thoughts: "a",
        emotions: "draft",
        behavior: "cut off",
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(extractRequest({ conversationId: id }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not extract an entry" });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns 429 once the caller's rate-limit bucket is exhausted", async () => {
    const clientId = await seedUser();
    mockSession(clientId);
    const { id } = await createConversation(clientId, "Slow down");
    for (let i = 0; i < 25; i++) chatRateLimiter.consume(clientId);

    const res = await POST(extractRequest({ conversationId: id }));
    expect(res.status).toBe(429);
  });
});
