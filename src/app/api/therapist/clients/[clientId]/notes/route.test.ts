import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNote } from "@/lib/therapist-notes";
import { acceptInvite, createInvite } from "@/lib/therapist-links";

type Session = { user: { id: string; role: "client" | "therapist" } } | null;
let session: Session = null;

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET } from "./route";

afterEach(() => {
  session = null;
});

function ctxFor(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

describe("GET /api/therapist/clients/[clientId]/notes", () => {
  it("returns 404 when there is no session", async () => {
    session = null;
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a client-role caller", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "client" } };
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 400 for an invalid clientId", async () => {
    session = { user: { id: `test-${randomUUID()}`, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(""));
    expect(res.status).toBe(400);
  });

  it("lists the therapist's own notes for a linked client", async () => {
    const clientId = `test-${randomUUID()}`;
    const therapistId = `test-${randomUUID()}`;
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    await createNote(therapistId, clientId, { kind: "private", body: "First impression" });

    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(clientId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].body).toBe("First impression");
  });

  it("returns an empty list — not 404 — for a foreign clientId with no link to this therapist", async () => {
    const therapistId = `test-${randomUUID()}`;
    session = { user: { id: therapistId, role: "therapist" } };
    const res = await GET(new Request("http://localhost"), ctxFor(`test-${randomUUID()}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
