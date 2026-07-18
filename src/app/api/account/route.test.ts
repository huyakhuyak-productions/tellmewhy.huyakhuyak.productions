import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { accountDeleteRateLimiter } from "@/lib/rate-limit";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Spied so tests can control deleteAccount's outcome without running the
// real (transactional, multi-table) deletion — this route's only job is
// translating domain errors to status codes.
vi.mock("@/lib/account-deletion", { spy: true });

import { deleteAccount } from "@/lib/account-deletion";
import { DELETE } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});

function deleteRequest(body: string) {
  return DELETE(
    new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}

describe("DELETE /api/account", () => {
  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await deleteRequest(JSON.stringify({ password: "hunter2" }));
    expect(res.status).toBe(401);
  });

  // Each test below (aside from the dedicated 429 test) uses its own user id
  // so it draws from a fresh accountDeleteRateLimiter bucket (capacity 3)
  // instead of sharing — and possibly exhausting — the module-level state
  // with its neighbors.

  it("returns 400 for a malformed (non-JSON) body, never a 500", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    const res = await deleteRequest("not json");
    expect(res.status).toBe(400);
  });

  it("returns 400 when the password field is missing", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    const res = await deleteRequest(JSON.stringify({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 with the module's message when the password is wrong", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    vi.mocked(deleteAccount).mockRejectedValueOnce(new ValidationError("Incorrect password"));
    const res = await deleteRequest(JSON.stringify({ password: "wrong" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Incorrect password");
  });

  it("returns 404 when the module reports the user missing", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    vi.mocked(deleteAccount).mockRejectedValueOnce(new NotFoundError("User not found"));
    const res = await deleteRequest(JSON.stringify({ password: "hunter2" }));
    expect(res.status).toBe(404);
  });

  it("returns 204 on success", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    vi.mocked(deleteAccount).mockResolvedValueOnce(undefined);
    const res = await deleteRequest(JSON.stringify({ password: "hunter2" }));
    expect(res.status).toBe(204);
  });

  it("returns 429 once the per-user account-delete bucket is exhausted", async () => {
    const dedicatedUserId = `test-${randomUUID()}`;
    session = { user: { id: dedicatedUserId } };
    for (let i = 0; i < 3; i++) accountDeleteRateLimiter.consume(dedicatedUserId);

    const res = await deleteRequest(JSON.stringify({ password: "hunter2" }));
    expect(res.status).toBe(429);
  });
});
