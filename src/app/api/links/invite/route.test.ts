import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { therapistLinks } from "@/db/schema";
import chatRateLimiter, { conversationCreateRateLimiter, inviteCreateRateLimiter } from "@/lib/rate-limit";
import { createInvite } from "@/lib/therapist-links";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = { user: { id: userId, role: "client" } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Spied so a single failure test can make createInvite throw an
// infrastructure-shaped error; every other test hits the real implementation.
vi.mock("@/lib/therapist-links", { spy: true });

import { POST } from "./route";

afterEach(() => {
  session = { user: { id: userId, role: "client" } };
});

describe("POST /api/links/invite", () => {
  it("creates a client-initiated invite when the caller is a client", async () => {
    const res = await POST();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.linkId).toBe("string");
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThanOrEqual(20);
    expect(body.path).toBe(`/link/${body.token}`);

    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, body.linkId));
    expect(row.initiatedBy).toBe("client");
    expect(row.clientId).toBe(userId);
  });

  it("creates a therapist-initiated invite when the caller is a therapist", async () => {
    const therapistUserId = `test-${randomUUID()}`;
    session = { user: { id: therapistUserId, role: "therapist" } };
    const res = await POST();
    expect(res.status).toBe(201);
    const body = await res.json();

    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, body.linkId));
    expect(row.initiatedBy).toBe("therapist");
    expect(row.therapistId).toBe(therapistUserId);
  });

  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("maps the module's already-linked business error to 400", async () => {
    const dedicatedUserId = `test-${randomUUID()}`;
    session = { user: { id: dedicatedUserId, role: "client" } };
    const first = await POST();
    expect(first.status).toBe(201);

    const second = await POST();
    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error).toMatch(/already has a pending or active therapist link/);
  });

  it("rethrows a non-validation failure instead of echoing it as a 400", async () => {
    // A dedicated session id so this doesn't nibble the shared userId's
    // invite bucket. An infrastructure-shaped error (DB, crypto) must never
    // surface its internal message in a 4xx body — the route rethrows and
    // Next answers 500.
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    vi.mocked(createInvite).mockRejectedValueOnce(new Error("connection terminated"));

    await expect(POST()).rejects.toThrow("connection terminated");
  });

  it("never logs the raw invite token", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST();
    const body = await res.json();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(body.token));
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  // Runs last: it drains the shared in-memory bucket for `userId`, which
  // would make an earlier test in this file see a 429 if it ran after this
  // one — same ordering rationale as conversations/route.test.ts.
  it("returns 429 once the per-user invite-create bucket is exhausted", async () => {
    for (let i = 0; i < 5; i++) inviteCreateRateLimiter.consume(userId);

    const res = await POST();
    expect(res.status).toBe(429);
  });

  // The invite-create bucket is its own instance with its own namespace —
  // draining it must never throttle the chat or conversation-create buckets,
  // and vice versa.
  it("keeps the invite-create bucket isolated from chat and conversation-create buckets", async () => {
    for (let i = 0; i < 5; i++) inviteCreateRateLimiter.consume(userId);
    expect(inviteCreateRateLimiter.consume(userId)).toBe(false);
    expect(chatRateLimiter.consume(userId)).toBe(true);
    expect(conversationCreateRateLimiter.consume(userId)).toBe(true);
  });
});
