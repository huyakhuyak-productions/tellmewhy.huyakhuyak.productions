import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/errors";

const userId = `test-${randomUUID()}`;
type Session = { user: { id: string } } | null;
let session: Session = { user: { id: userId } };

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => session) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Spied so a single test can make acknowledgeDeparture throw a domain error;
// the success test hits the real implementation.
vi.mock("@/lib/therapist-links", { spy: true });

import { acknowledgeDeparture } from "@/lib/therapist-links";
import { POST } from "./route";

afterEach(() => {
  session = { user: { id: userId } };
});

function acknowledgeRequest(linkId: string) {
  return POST(
    new Request(`http://localhost/api/links/${linkId}/acknowledge-departure`, { method: "POST" }),
    { params: Promise.resolve({ linkId }) },
  );
}

describe("POST /api/links/[linkId]/acknowledge-departure", () => {
  it("returns 401 when there is no session", async () => {
    session = null;
    const res = await acknowledgeRequest(randomUUID());
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed linkId", async () => {
    const res = await acknowledgeRequest("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the module reports nothing to acknowledge", async () => {
    vi.mocked(acknowledgeDeparture).mockRejectedValueOnce(new NotFoundError("No departure to acknowledge"));
    const res = await acknowledgeRequest(randomUUID());
    expect(res.status).toBe(404);
  });

  it("returns 204 on success", async () => {
    vi.mocked(acknowledgeDeparture).mockResolvedValueOnce(undefined);
    const res = await acknowledgeRequest(randomUUID());
    expect(res.status).toBe(204);
  });
});
