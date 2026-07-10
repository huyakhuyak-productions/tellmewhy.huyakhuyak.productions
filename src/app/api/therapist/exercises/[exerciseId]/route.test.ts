import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignExercise } from "@/lib/exercises";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = null;

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PATCH } from "./route";

afterEach(() => {
  session = null;
});

function ctxFor(exerciseId: string) {
  return { params: Promise.resolve({ exerciseId }) };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function assignedExercise() {
  const clientId = `test-${randomUUID()}`;
  const therapistId = `test-${randomUUID()}`;
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  const { id } = await assignExercise(therapistId, clientId, { type: "thought_record", instruction: "Notice" });
  return { clientId, therapistId, exerciseId: id };
}

describe("PATCH /api/therapist/exercises/[exerciseId]", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await PATCH(jsonRequest({ status: "closed" }), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await PATCH(jsonRequest({ status: "closed" }), ctxFor(randomUUID()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 for a non-uuid exerciseId", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await PATCH(jsonRequest({ status: "closed" }), ctxFor("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed body", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await PATCH(jsonRequest({ status: "active" }), ctxFor(randomUUID()));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a foreign therapist closing another's exercise", async () => {
    const { exerciseId } = await assignedExercise();
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await PATCH(jsonRequest({ status: "closed" }), ctxFor(exerciseId));
    expect(res.status).toBe(404);
  });

  it("closes the exercise and returns 204 for the assigning therapist", async () => {
    const { therapistId, exerciseId } = await assignedExercise();
    session = { user: { id: therapistId, role: "therapist" } };
    const res = await PATCH(jsonRequest({ status: "closed" }), ctxFor(exerciseId));
    expect(res.status).toBe(204);
  });
});
