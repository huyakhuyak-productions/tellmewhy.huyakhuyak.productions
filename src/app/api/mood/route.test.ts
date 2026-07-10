import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkInMood, listMoodCheckins } from "@/lib/mood";
import { moodRateLimiter } from "@/lib/rate-limit";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Spied so a single failure test can make checkInMood throw an
// infrastructure-shaped error; every other test hits the real implementation.
vi.mock("@/lib/mood", { spy: true });

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

  it("clamps days=0 up to 1 instead of falling back to the default window", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    // A check-in 10 days back sits inside the 56-day default window but
    // outside a 1-day one — so it tells a clamp-to-1 apart from a fallthrough
    // to the default.
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await checkInMood(clientId, { score: 2 }, tenDaysAgo);

    const clamped = await (await GET(getRequest("?days=0"))).json();
    expect(clamped.checkins).toEqual([]);

    const defaulted = await (await GET(getRequest())).json();
    expect(defaulted.checkins).toHaveLength(1);
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

  it("returns 400 with the domain's static message for an out-of-range score", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    const res = await POST(jsonRequest("POST", { score: 7 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/whole number from 1 to 5/);
  });

  it("rethrows a non-validation failure instead of echoing it as a 400", async () => {
    const clientId = `test-${randomUUID()}`;
    session = { user: { id: clientId } };
    // An infrastructure-shaped error (DB, crypto) must never surface its
    // internal message in a 4xx body — the route rethrows and Next answers 500.
    vi.mocked(checkInMood).mockRejectedValueOnce(new Error("connection terminated"));

    await expect(POST(jsonRequest("POST", { score: 4 }))).rejects.toThrow("connection terminated");
  });

  // Runs last: drains the shared per-user bucket for `userId`, so it must not
  // precede any test that POSTs as this same `userId`.
  it("returns 429 once the per-user mood bucket is exhausted", async () => {
    for (let i = 0; i < 10; i++) moodRateLimiter.consume(userId);
    const res = await POST(jsonRequest("POST", { score: 4 }));
    expect(res.status).toBe(429);
  });
});
