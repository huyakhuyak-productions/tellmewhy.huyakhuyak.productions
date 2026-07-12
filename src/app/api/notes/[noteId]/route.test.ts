import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNote, listNotes } from "@/lib/notes";

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

function ctx(noteId: string) {
  return { params: Promise.resolve({ noteId }) };
}

describe("DELETE /api/notes/[noteId]", () => {
  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await DELETE(new Request("http://localhost/api/notes/x"), ctx(randomUUID()));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-uuid noteId", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    const res = await DELETE(new Request("http://localhost/api/notes/nope"), ctx("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("deletes the caller's own note and leaves no row behind", async () => {
    const owner = `test-${randomUUID()}`;
    session = { user: { id: owner } };
    const { id } = await createNote(owner, { body: "let this one go" });

    const res = await DELETE(new Request(`http://localhost/api/notes/${id}`), ctx(id));
    expect(res.status).toBe(204);
    expect(await listNotes(owner)).toHaveLength(0);
  });

  it("returns 404 (never a hint) for a note owned by someone else", async () => {
    const otherId = `test-${randomUUID()}`;
    const { id: theirs } = await createNote(otherId, { body: "theirs" });

    const owner = `test-${randomUUID()}`;
    session = { user: { id: owner } };
    const res = await DELETE(new Request(`http://localhost/api/notes/${theirs}`), ctx(theirs));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    // The foreign note is untouched by the refused delete.
    expect(await listNotes(otherId)).toHaveLength(1);
  });

  it("returns 404 for a nonexistent noteId", async () => {
    session = { user: { id: `test-${randomUUID()}` } };
    const res = await DELETE(new Request("http://localhost/api/notes/x"), ctx(randomUUID()));
    expect(res.status).toBe(404);
  });
});
