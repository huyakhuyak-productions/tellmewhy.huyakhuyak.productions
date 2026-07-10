import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignExercise, saveEntry } from "@/lib/exercises";
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

async function withAssignedExercise(clientId: string): Promise<{ exerciseId: string }> {
  const therapistId = `test-${randomUUID()}`;
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  const { id } = await assignExercise(therapistId, clientId, {
    type: "thought_record",
    instruction: "Notice one anxious moment this week.",
  });
  return { exerciseId: id };
}

describe("GET /api/exercises", () => {
  it("returns the client's assigned exercises and their own entries in one payload", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const { exerciseId } = await withAssignedExercise(clientId);
    await saveEntry(clientId, {
      exerciseId,
      payload: { situation: "meeting", thoughts: "I'll fail", emotions: "fear", behavior: "froze" },
    });

    const body = await (await GET()).json();
    expect(body.exercises.map((e: { id: string }) => e.id)).toContain(exerciseId);
    expect(body.entries.some((e: { exerciseId: string | null }) => e.exerciseId === exerciseId)).toBe(true);
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
