import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { getMoodSharingState } from "@/lib/mood";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PUT } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/mood/sharing", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// getMoodSharingState / setMoodSharing both inner-join the therapist's user
// row, so the link's therapist must exist as a real user for the state to
// resolve — a bare random id would make the join drop the row.
async function insertTherapist(): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name: "Dr. Test",
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: "therapist",
  });
  return id;
}

async function withActiveLink(clientId: string): Promise<void> {
  const therapistId = await insertTherapist();
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
}

describe("PUT /api/mood/sharing", () => {
  it("enables mood sharing on the active link", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    await withActiveLink(clientId);

    const res = await PUT(jsonRequest({ enabled: true }));
    expect(res.status).toBe(204);
    expect(await getMoodSharingState(clientId)).toBe(true);
  });

  it("disables mood sharing again", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    await withActiveLink(clientId);
    await PUT(jsonRequest({ enabled: true }));

    const res = await PUT(jsonRequest({ enabled: false }));
    expect(res.status).toBe(204);
    expect(await getMoodSharingState(clientId)).toBe(false);
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await PUT(jsonRequest({ enabled: true }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed body", async () => {
    const res = await PUT(jsonRequest({ enabled: "yes" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the caller has no active therapist link", async () => {
    const soloId = `test-${randomUUID()}`;
    session = { user: { id: soloId } };
    const res = await PUT(jsonRequest({ enabled: true }));
    expect(res.status).toBe(404);
  });
});
