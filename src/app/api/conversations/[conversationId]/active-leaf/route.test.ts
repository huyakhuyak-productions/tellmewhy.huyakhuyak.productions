import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createConversation, loadMessages, saveMessage } from "@/lib/conversations";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST } from "./route";

beforeAll(async () => {
  await seedUser(userId);
});
afterAll(cleanupSeededUsers);

afterEach(() => {
  session = { user: { id: userId } };
});

function activeLeafRequest(conversationId: string, body: unknown) {
  const req = new Request(`http://localhost/api/conversations/${conversationId}/active-leaf`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ conversationId }) });
}

// Seeds a conversation whose active leaf is a branch: root -> {branchA, branchB},
// with branchB the current leaf. Returns both children so a test can switch.
async function seedBranch(ownerId: string) {
  const conv = await createConversation(ownerId, "Branched");
  const root = await saveMessage({ conversationId: conv.id, userId: ownerId, sender: "client", text: "root", parentId: null });
  const branchA = await saveMessage({ conversationId: conv.id, userId: ownerId, sender: "ai", text: "A", parentId: root.id });
  const branchB = await saveMessage({ conversationId: conv.id, userId: ownerId, sender: "ai", text: "B", parentId: root.id });
  return { conv, root, branchA, branchB };
}

describe("POST /api/conversations/[conversationId]/active-leaf", () => {
  it("switches the active path so loadMessages reflects the chosen branch", async () => {
    const { conv, root, branchA, branchB } = await seedBranch(userId);

    // Fresh seed lands on branchB (the last append).
    expect((await loadMessages(conv.id, userId)).map((m) => m.id)).toEqual([root.id, branchB.id]);

    const res = await activeLeafRequest(conv.id, { messageId: branchA.id });
    expect(res.status).toBe(204);
    expect((await loadMessages(conv.id, userId)).map((m) => m.id)).toEqual([root.id, branchA.id]);
  });

  it("returns 404 for a messageId belonging to a different conversation", async () => {
    const { conv } = await seedBranch(userId);
    const other = await seedBranch(userId);

    const res = await activeLeafRequest(conv.id, { messageId: other.branchA.id });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 404 (never a hint) for a conversation owned by someone else", async () => {
    const { branchA } = await seedBranch(await seedUser());
    const foreign = await seedBranch(await seedUser());

    const res = await activeLeafRequest(foreign.conv.id, { messageId: branchA.id });
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed messageId", async () => {
    const { conv } = await seedBranch(userId);
    const res = await activeLeafRequest(conv.id, { messageId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed conversationId", async () => {
    const res = await activeLeafRequest("not-a-uuid", { messageId: randomUUID() });
    expect(res.status).toBe(400);
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await activeLeafRequest(randomUUID(), { messageId: randomUUID() });
    expect(res.status).toBe(401);
  });
});
