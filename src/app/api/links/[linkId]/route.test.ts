import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { therapistLinks } from "@/db/schema";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { DELETE } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});

function deleteRequest(linkId: string) {
  return DELETE(new Request(`http://localhost/api/links/${linkId}`, { method: "DELETE" }), {
    params: Promise.resolve({ linkId }),
  });
}

describe("DELETE /api/links/[linkId]", () => {
  it("revokes a link owned by the calling client", async () => {
    const { linkId, token } = await createInvite(userId, "client");
    const therapistId = `test-${randomUUID()}`;
    await acceptInvite(token, therapistId);

    const res = await deleteRequest(linkId);
    expect(res.status).toBe(204);

    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(row.status).toBe("revoked");
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await deleteRequest(randomUUID());
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed linkId", async () => {
    const res = await deleteRequest("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns 404 (never a hint) when a stranger tries to revoke someone else's link", async () => {
    const clientId = `test-${randomUUID()}`;
    const { linkId, token } = await createInvite(clientId, "client");
    const therapistId = `test-${randomUUID()}`;
    await acceptInvite(token, therapistId);

    const stranger = `test-${randomUUID()}`;
    session = { user: { id: stranger } };
    const res = await deleteRequest(linkId);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent linkId", async () => {
    const res = await deleteRequest(randomUUID());
    expect(res.status).toBe(404);
  });
});
