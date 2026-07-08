import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { createConversation } from "@/lib/conversations";
import { grantConversation } from "@/lib/sharing";
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

describe("GET /api/trust", () => {
  it("returns null link, empty grants, and empty audit for a client with no link", async () => {
    const soloId = `test-${randomUUID()}`;
    session = { user: { id: soloId } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link: null, grants: [], audit: [] });
  });

  it("returns link state, granted conversation ids, and the audit feed in one payload", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const therapistId = await insertTherapist("Dr. Amaro");
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Trust me");
    await grantConversation(clientId, conv.id);

    const res = await GET();
    const body = await res.json();
    expect(body.link).toEqual({ linkId, therapistId, therapistName: "Dr. Amaro" });
    expect(body.grants).toEqual([conv.id]);
    expect(Array.isArray(body.audit)).toBe(true);
    expect(body.audit.length).toBeGreaterThan(0);
    expect(body.audit.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(["link_invited", "link_accepted", "grant_created"]),
    );
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
