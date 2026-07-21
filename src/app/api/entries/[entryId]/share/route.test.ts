import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignExercise, listEntriesForClient, saveEntry } from "@/lib/exercises";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});
afterEach(cleanupSeededUsers);

function shareRequest(entryId: string) {
  const req = new Request(`http://localhost/api/entries/${entryId}/share`, { method: "POST" });
  return POST(req, { params: Promise.resolve({ entryId }) });
}

const validPayload = {
  situation: "gave a talk",
  thoughts: "I stumbled",
  emotions: "embarrassment",
  behavior: "left early",
};

// A completed entry anchored to an active-link exercise — the only shareable
// kind (self-guided entries have no exercise to join, so they can't be shared).
async function anchoredEntryFor(clientId: string): Promise<string> {
  const therapistId = `test-${randomUUID()}`;
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  const { id: exerciseId } = await assignExercise(therapistId, clientId, {
    type: "thought_record",
    instruction: "Capture one hard moment.",
  });
  const { id } = await saveEntry(clientId, { exerciseId, payload: validPayload });
  return id;
}

describe("POST /api/entries/[entryId]/share", () => {
  it("shares an entry anchored to the caller's active link", async () => {
    const clientId = await seedUser();
    session = { user: { id: clientId } };
    const entryId = await anchoredEntryFor(clientId);

    const res = await shareRequest(entryId);
    expect(res.status).toBe(204);
    const entry = (await listEntriesForClient(clientId)).find((e) => e.id === entryId);
    expect(entry?.sharedAt).not.toBeNull();
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await shareRequest(randomUUID());
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed entryId", async () => {
    const res = await shareRequest("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns 404 (never a hint) sharing an entry owned by someone else", async () => {
    const foreignId = await seedUser();
    const foreignEntry = await anchoredEntryFor(foreignId);
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };

    const res = await shareRequest(foreignEntry);
    expect(res.status).toBe(404);
  });

  it("returns 404 sharing a self-guided entry that has no exercise to join", async () => {
    const clientId = await seedUser();
    session = { user: { id: clientId } };
    const { id } = await saveEntry(clientId, { payload: validPayload });

    const res = await shareRequest(id);
    expect(res.status).toBe(404);
  });
});
