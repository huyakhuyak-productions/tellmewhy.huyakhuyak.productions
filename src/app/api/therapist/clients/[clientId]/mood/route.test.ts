import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { checkInMood, setMoodSharing } from "@/lib/mood";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

// getMoodTrendForTherapist / setMoodSharing inner-join the `user` table (to
// resolve names), so a genuinely-active link only resolves when both parties
// have a real user row — random ids alone would 404 for the wrong reason.
async function insertUser(): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: "client",
  });
  return id;
}

async function linkedUsers() {
  const clientId = await insertUser();
  const therapistId = await insertUser();
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
  return { clientId, therapistId };
}

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

function ctxFor(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

describe("GET /api/therapist/clients/[clientId]/mood", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 for an invalid clientId", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(""));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the client has mood sharing toggled off", async () => {
    const { clientId, therapistId } = await linkedUsers();
    // Linked, but the mood-sharing toggle was never enabled.
    await checkInMood(clientId, { score: 3 }, "2026-01-10");

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(clientId));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client not linked to this therapist", async () => {
    const therapistId = `test-${randomUUID()}`;
    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("returns the mood trend when sharing is enabled", async () => {
    const { clientId, therapistId } = await linkedUsers();
    await setMoodSharing(clientId, true);
    // No explicit day → today, so the check-in falls inside the 56-day trend window.
    await checkInMood(clientId, { score: 4, note: "steady" });

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(clientId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trend).toHaveLength(1);
    expect(body.trend[0].score).toBe(4);
    expect(body.trend[0]).not.toHaveProperty("note");
  });
});
