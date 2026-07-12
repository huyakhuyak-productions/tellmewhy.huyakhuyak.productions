import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversation, saveMessage } from "@/lib/conversations";
import { MAX_NOTE_BODY_LENGTH } from "@/lib/notes";
import { noteRateLimiter } from "@/lib/rate-limit";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET, POST } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Seeds a conversation + one encrypted message owned by ownerId; returns messageId.
async function seedMessage(ownerId: string, text: string): Promise<string> {
  const conv = await createConversation(ownerId, "Kept from chat");
  const message = await saveMessage({ conversationId: conv.id, userId: ownerId, sender: "client", text });
  return message.id;
}

describe("POST /api/notes", () => {
  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await POST(jsonRequest({ body: "no auth" }));
    expect(res.status).toBe(401);
  });

  it("creates a hand-written note and lists it back", async () => {
    const owner = `test-${randomUUID()}`;
    session = { user: { id: owner } };

    const res = await POST(jsonRequest({ body: "breathe first, decide after" }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(typeof id).toBe("string");

    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const { notes } = await listRes.json();
    expect(notes.map((n: { id: string }) => n.id)).toContain(id);
    expect(notes.find((n: { id: string }) => n.id === id)?.body).toBe("breathe first, decide after");
  });

  it("keeps one of the caller's own chat messages", async () => {
    const owner = `test-${randomUUID()}`;
    const messageId = await seedMessage(owner, "I froze in the meeting again");
    session = { user: { id: owner } };

    const res = await POST(jsonRequest({ messageId }));
    expect(res.status).toBe(201);
    const { id } = await res.json();

    const { notes } = await (await GET()).json();
    expect(notes.find((n: { id: string }) => n.id === id)).toMatchObject({
      body: "I froze in the meeting again",
      sourceMessageId: messageId,
    });
  });

  it("returns 404 (never a hint) for a message from someone else's conversation", async () => {
    const foreignMessage = await seedMessage(`test-${randomUUID()}`, "not yours to keep");

    const owner = `test-${randomUUID()}`;
    session = { user: { id: owner } };
    const res = await POST(jsonRequest({ messageId: foreignMessage }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 when neither body nor messageId is present", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when both body and messageId are present", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    const res = await POST(jsonRequest({ body: "one source only", messageId: randomUUID() }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty body", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    const res = await POST(jsonRequest({ body: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a body over the maximum length", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    const res = await POST(jsonRequest({ body: "x".repeat(MAX_NOTE_BODY_LENGTH + 1) }));
    expect(res.status).toBe(400);
  });

  it("lets a therapist-role session manage its own notes (notes are per-user, not per-role)", async () => {
    // The session shape carries no role; the route never inspects one. Using a
    // distinct therapist-flavoured id proves ownership, not role, gates a note.
    const therapistId = `test-therapist-${randomUUID()}`;
    session = { user: { id: therapistId } };

    const res = await POST(jsonRequest({ body: "reflect on today's session" }));
    expect(res.status).toBe(201);
    const { notes } = await (await GET()).json();
    expect(notes.map((n: { body: string }) => n.body)).toContain("reflect on today's session");
  });

  // Runs last: drains the shared per-user bucket for `userId`.
  it("returns 429 once the per-user note bucket is exhausted", async () => {
    for (let i = 0; i < 10; i++) noteRateLimiter.consume(userId);
    const res = await POST(jsonRequest({ body: "one too many" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "A gentle pace — try again in a moment" });
  });
});

describe("GET /api/notes", () => {
  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns only the caller's own notes", async () => {
    const mine = `test-${randomUUID()}`;
    const theirs = `test-${randomUUID()}`;

    session = { user: { id: theirs } };
    await POST(jsonRequest({ body: "theirs, not mine" }));

    session = { user: { id: mine } };
    await POST(jsonRequest({ body: "mine alone" }));

    const { notes } = await (await GET()).json();
    const bodies = notes.map((n: { body: string }) => n.body);
    expect(bodies).toContain("mine alone");
    expect(bodies).not.toContain("theirs, not mine");
  });
});
