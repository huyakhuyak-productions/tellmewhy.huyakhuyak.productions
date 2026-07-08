import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = { user: { id: userId, role: "client" } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET } from "./route";

afterEach(() => {
  session = { user: { id: userId, role: "client" } };
});

async function insertUser(name: string, role: "client" | "therapist" = "therapist"): Promise<string> {
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

describe("GET /api/links/me", () => {
  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns a null link for a client with no invite at all", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId, role: "client" } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "client", link: null });
  });

  it("returns the pending state for a client with an unaccepted client-initiated invite", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId, role: "client" } };
    const { linkId } = await createInvite(clientId, "client");

    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ role: "client", link: { linkId, status: "invited" } });
  });

  it("returns the active link with the therapist's display name for a client", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId, role: "client" } };
    const therapistId = await insertUser("Dr. Kelso");
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);

    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      role: "client",
      link: { linkId, status: "active", therapistId, therapistName: "Dr. Kelso" },
    });
  });

  it("returns the list of active client links with display names for a therapist", async () => {
    const therapistId = `test-${randomUUID()}`;
    session = { user: { id: therapistId, role: "therapist" } };
    const clientId = await insertUser("Jamie", "client");
    const { linkId, token } = await createInvite(therapistId, "therapist");
    await acceptInvite(token, clientId);

    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      role: "therapist",
      links: [{ linkId, clientId, clientName: "Jamie" }],
    });
  });
});
