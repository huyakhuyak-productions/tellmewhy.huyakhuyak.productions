import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignExercise, saveEntry, shareEntry } from "@/lib/exercises";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = null;

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET } from "./route";

afterEach(() => {
  session = null;
});

function ctxFor(entryId: string) {
  return { params: Promise.resolve({ entryId }) };
}

const payload = {
  situation: "Meeting",
  thoughts: "I'll fail",
  emotions: "Anxious",
  behavior: "Avoided",
};

async function entryFor(shared: boolean) {
  const clientId = `test-${randomUUID()}`;
  const therapistId = `test-${randomUUID()}`;
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  const { id: exerciseId } = await assignExercise(therapistId, clientId, {
    type: "thought_record",
    instruction: "Notice",
  });
  const { id: entryId } = await saveEntry(clientId, { exerciseId, payload });
  if (shared) await shareEntry(clientId, entryId);
  return { clientId, therapistId, entryId };
}

describe("GET /api/therapist/entries/[entryId]", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await GET(new Request("http://localhost"), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await GET(new Request("http://localhost"), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 for a non-uuid entryId", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an entry the client has not shared", async () => {
    const { therapistId, entryId } = await entryFor(false);
    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(entryId));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a foreign therapist reading a shared entry", async () => {
    const { entryId } = await entryFor(true);
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(entryId));
    expect(res.status).toBe(404);
  });

  it("returns the shared entry to the assigning therapist", async () => {
    const { therapistId, entryId } = await entryFor(true);
    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(entryId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.payload).toEqual(payload);
    expect(body.entry.createdAt).toEqual(expect.any(String));
  });
});
