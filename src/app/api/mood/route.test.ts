import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listMoodCheckins } from "@/lib/mood";
import { moodRateLimiter } from "@/lib/rate-limit";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET, POST } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/mood", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(query = "") {
  return new Request(`http://localhost/api/mood${query}`, { method: "GET" });
}

describe("POST/GET /api/mood", () => {
  it("records a check-in the client can then read back", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };

    const res = await POST(jsonRequest("POST", { score: 4, note: "steadier today" }));
    expect(res.status).toBe(204);

    const checkins = await listMoodCheckins(clientId, 56);
    expect(checkins.at(-1)).toMatchObject({ score: 4, note: "steadier today" });
  });

  it("returns the check-ins for the caller as { checkins }", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    await POST(jsonRequest("POST", { score: 3 }));

    const body = await (await GET(getRequest("?days=56"))).json();
    expect(Array.isArray(body.checkins)).toBe(true);
    expect(body.checkins.at(-1)).toMatchObject({ score: 3, note: null });
  });

  it("tolerates an out-of-range days query by clamping instead of erroring", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const res = await GET(getRequest("?days=99999"));
    expect(res.status).toBe(200);
  });

  it("returns 401 for POST when there is no session", async () => {
    session = null;
    const res = await POST(jsonRequest("POST", { score: 4 }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for GET when there is no session", async () => {
    session = null;
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("returns 400 for an out-of-range score", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const res = await POST(jsonRequest("POST", { score: 7 }));
    expect(res.status).toBe(400);
  });

  // Runs last: drains the shared per-user bucket for `userId`, so it must not
  // precede any test that POSTs as this same `userId`.
  it("returns 429 once the per-user mood bucket is exhausted", async () => {
    for (let i = 0; i < 10; i++) moodRateLimiter.consume(userId);
    const res = await POST(jsonRequest("POST", { score: 4 }));
    expect(res.status).toBe(429);
  });
});
