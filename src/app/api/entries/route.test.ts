import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignExercise, listEntriesForClient } from "@/lib/exercises";
import { entryRateLimiter } from "@/lib/rate-limit";
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

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  situation: "gave a talk",
  thoughts: "everyone noticed I stumbled",
  emotions: "embarrassment",
  behavior: "avoided eye contact",
};

async function assignedExerciseFor(clientId: string): Promise<string> {
  const therapistId = `test-${randomUUID()}`;
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  const { id } = await assignExercise(therapistId, clientId, {
    type: "thought_record",
    instruction: "Capture one hard moment.",
  });
  return id;
}

describe("POST /api/entries", () => {
  it("saves a self-guided entry and returns its id", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };

    const res = await POST(jsonRequest({ payload: validPayload }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(typeof id).toBe("string");

    const entries = await listEntriesForClient(clientId);
    expect(entries.map((e) => e.id)).toContain(id);
  });

  it("saves an entry anchored to one of the caller's own exercises", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const exerciseId = await assignedExerciseFor(clientId);

    const res = await POST(jsonRequest({ exerciseId, payload: validPayload }));
    expect(res.status).toBe(201);
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await POST(jsonRequest({ payload: validPayload }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when a required field is empty", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const res = await POST(jsonRequest({ payload: { ...validPayload, situation: "" } }));
    expect(res.status).toBe(400);
  });

  it("returns 404 (never a hint) for an exercise owned by someone else", async () => {
    const foreignId = `test-${randomUUID()}`;
    const foreignExercise = await assignedExerciseFor(foreignId);

    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const res = await POST(jsonRequest({ exerciseId: foreignExercise, payload: validPayload }));
    expect(res.status).toBe(404);
  });

  // Runs last: drains the shared per-user bucket for `userId`.
  it("returns 429 once the per-user entry bucket is exhausted", async () => {
    for (let i = 0; i < 10; i++) entryRateLimiter.consume(userId);
    const res = await POST(jsonRequest({ payload: validPayload }));
    expect(res.status).toBe(429);
  });
});
