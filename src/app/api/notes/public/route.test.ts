import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { createConversation } from "@/lib/conversations";
import { grantConversation } from "@/lib/sharing";
import { createNote } from "@/lib/therapist-notes";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});

async function insertTherapist(name: string): Promise<string> {
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

function notesRequest(conversationId?: string) {
  const url = conversationId
    ? `http://localhost/api/notes/public?conversationId=${conversationId}`
    : "http://localhost/api/notes/public";
  return GET(new Request(url));
}

describe("GET /api/notes/public", () => {
  it("returns client-scoped public notes when conversationId is absent", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const therapistId = await insertTherapist("Dr. Osei");
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    await createNote(therapistId, clientId, { kind: "public", body: "Doing well overall." });
    await createNote(therapistId, clientId, { kind: "private", body: "secret" });

    const res = await notesRequest();
    expect(res.status).toBe(200);
    const notes = await res.json();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ body: "Doing well overall.", therapistName: "Dr. Osei", conversationId: null });
  });

  it("returns conversation-scoped public notes when conversationId is present", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const therapistId = await insertTherapist("Dr. Lang");
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Scoped");
    await grantConversation(clientId, conv.id);
    await createNote(therapistId, clientId, { conversationId: conv.id, kind: "public", body: "About this chat." });
    await createNote(therapistId, clientId, { kind: "public", body: "Client-scoped, unrelated." });

    const res = await notesRequest(conv.id);
    const notes = await res.json();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ body: "About this chat.", conversationId: conv.id });
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await notesRequest();
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed conversationId", async () => {
    const res = await notesRequest("not-a-uuid");
    expect(res.status).toBe(400);
  });
});
