import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";

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
});
