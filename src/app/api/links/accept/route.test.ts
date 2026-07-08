import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInvite } from "@/lib/therapist-links";

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

function acceptRequest(body: unknown) {
  return POST(
    new Request("http://localhost/api/links/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/links/accept", () => {
  it("accepts a valid invite and returns the linkId, never echoing the token", async () => {
    const clientId = `test-${randomUUID()}`;
    const { linkId, token } = await createInvite(clientId, "client");

    const res = await acceptRequest({ token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.linkId).toBe(linkId);
    expect(body.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await acceptRequest({ token: "a".repeat(40) });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed body (token too short)", async () => {
    const res = await acceptRequest({ token: "short" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed (non-JSON) body, never a 500", async () => {
    const res = await POST(
      new Request("http://localhost/api/links/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("maps 'invite not found or already used' to 400 with the module's message, never echoing the token", async () => {
    const bogusToken = "b".repeat(43);
    const res = await acceptRequest({ token: bogusToken });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invite not found or already used/);
    expect(JSON.stringify(body)).not.toContain(bogusToken);
  });

  it("maps self-acceptance to 400", async () => {
    // A dedicated id, not the shared `userId` — a failed self-accept leaves
    // the invite row `invited` (never flips), which would otherwise leak a
    // pending link onto `userId` and break the one-active-link assumption
    // the later "already-linked" test below relies on.
    const soloId = `test-${randomUUID()}`;
    session = { user: { id: soloId } };
    const { token } = await createInvite(soloId, "client");
    const res = await acceptRequest({ token });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Cannot accept your own invite/);
  });

  it("maps the already-linked business error (accepting a second invite) to 400", async () => {
    const firstTherapist = `test-${randomUUID()}`;
    const { token: firstToken } = await createInvite(firstTherapist, "therapist");
    const acceptFirst = await acceptRequest({ token: firstToken });
    expect(acceptFirst.status).toBe(200);

    const secondTherapist = `test-${randomUUID()}`;
    const { token: secondToken } = await createInvite(secondTherapist, "therapist");
    const res = await acceptRequest({ token: secondToken });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already has a pending or active therapist link/);
  });
});
