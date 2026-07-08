import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
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

async function insertUser(name: string, role: "client" | "therapist"): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role,
  });
  return id;
}

describe("GET /api/therapist/clients", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller — indistinguishable from a nonexistent route", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId, role: "client" } };
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("lists the therapist's active clients with display names", async () => {
    const therapistId = await insertUser("Dr. Ada", "therapist");
    const clientId = await insertUser("Jamie", "client");
    const { linkId, token } = await createInvite(therapistId, "therapist");
    await acceptInvite(token, clientId);

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ linkId, clientId, clientName: "Jamie" }]);
  });

  it("returns an empty list for a therapist with no active clients", async () => {
    const therapistId = `test-${randomUUID()}`;
    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
