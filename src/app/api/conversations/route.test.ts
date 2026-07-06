import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import chatRateLimiter, { conversationCreateRateLimiter } from "@/lib/rate-limit";

const userId = `test-${randomUUID()}`;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: userId } })) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET, POST } from "./route";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/conversations", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("conversation routes", () => {
  it("creates and lists conversations", async () => {
    const res = await POST(jsonRequest("POST", { title: "first chat" }));
    expect(res.status).toBe(201);
    const list = await (await GET()).json();
    expect(list.map((c: { title: string }) => c.title)).toContain("first chat");
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  // Runs last in this file: it drains the shared in-memory bucket for
  // `userId`, which would make an earlier test in this file see a 429 if it
  // ran after this one. Exhausting via the limiter's own API (rather than
  // firing 10 real POSTs) keeps this fast and deterministic — see
  // src/lib/rate-limit.test.ts for the limiter's own consume/refill coverage.
  it("returns 429 once the per-user create bucket is exhausted", async () => {
    for (let i = 0; i < 10; i++) conversationCreateRateLimiter.consume(userId);

    const res = await POST(jsonRequest("POST", { title: "one too many" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "A gentle pace — try again in a moment" });
  });

  // The create bucket is its own instance with its own namespace — draining
  // it must never throttle the (separate) chat-send bucket, and vice versa.
  it("keeps the create bucket isolated from the chat bucket", async () => {
    for (let i = 0; i < 10; i++) conversationCreateRateLimiter.consume(userId);
    expect(conversationCreateRateLimiter.consume(userId)).toBe(false);
    expect(chatRateLimiter.consume(userId)).toBe(true);
  });
});
