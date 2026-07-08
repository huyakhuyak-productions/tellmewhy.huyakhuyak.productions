import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = null;

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { requireTherapist } from "./require-therapist";

afterEach(() => {
  session = null;
});

describe("requireTherapist", () => {
  it("returns 404 (never 401) when there is no session at all", async () => {
    session = null;
    const result = await requireTherapist();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
      expect(await result.response.json()).toEqual({ error: "Not found" });
    }
  });

  it("returns 404 (never 403) for a client-role session — indistinguishable from no session", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const result = await requireTherapist();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("passes through a therapist-role session with the caller's id", async () => {
    const therapistId = `test-${randomUUID()}`;
    session = { user: { id: therapistId, role: "therapist" } };
    const result = await requireTherapist();
    expect(result).toEqual({ ok: true, therapistId });
  });
});
