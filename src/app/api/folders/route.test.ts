import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const userId = `test-${randomUUID()}`;
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: userId } })) } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { GET, POST } from "./route";
import { PATCH as PATCH_FOLDER, DELETE as DELETE_FOLDER } from "./[folderId]/route";
import { PATCH as PATCH_CONV } from "../conversations/[conversationId]/route";
import { createConversation, isTitleCustomized, listConversations } from "@/lib/conversations";
import { createFolder, listFolders } from "@/lib/folders";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/folders", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("folder routes", () => {
  it("creates and lists folders", async () => {
    const res = await POST(jsonRequest("POST", { name: "family" }));
    expect(res.status).toBe(201);
    const list = await (await GET()).json();
    expect(list.map((f: { name: string }) => f.name)).toContain("family");
  });

  it("renames and deletes through the id route", async () => {
    const { id } = await createFolder(userId, "temp");
    const params = Promise.resolve({ folderId: id });
    const rename = await PATCH_FOLDER(jsonRequest("PATCH", { name: "kept" }), { params });
    expect(rename.status).toBe(204);
    const del = await DELETE_FOLDER(new Request("http://localhost", { method: "DELETE" }), { params });
    expect(del.status).toBe(204);
    expect((await listFolders(userId)).map((f) => f.name)).not.toContain("kept");
  });

  it("assigns a conversation to a folder and back to unsorted", async () => {
    const folder = await createFolder(userId, "work / career");
    const conv = await createConversation(userId, "standup dread");
    const params = Promise.resolve({ conversationId: conv.id });
    expect((await PATCH_CONV(jsonRequest("PATCH", { folderId: folder.id }), { params })).status).toBe(204);
    expect((await PATCH_CONV(jsonRequest("PATCH", { folderId: null }), { params })).status).toBe(204);
  });

  it("renames a conversation and reflects in listConversations with customized title", async () => {
    const conv = await createConversation(userId, "original title");
    const params = Promise.resolve({ conversationId: conv.id });
    const res = await PATCH_CONV(jsonRequest("PATCH", { title: "new title" }), { params });
    expect(res.status).toBe(204);
    const conversations = await listConversations(userId);
    const renamed = conversations.find((c) => c.id === conv.id);
    expect(renamed?.title).toBe("new title");
    expect(await isTitleCustomized(conv.id, userId)).toBe(true);
  });

  it("rejects empty object with 400", async () => {
    const conv = await createConversation(userId, "original title");
    const params = Promise.resolve({ conversationId: conv.id });
    const res = await PATCH_CONV(jsonRequest("PATCH", {}), { params });
    expect(res.status).toBe(400);
  });

  it("returns 404 when renaming with foreign conversation id", async () => {
    const foreignId = randomUUID();
    const params = Promise.resolve({ conversationId: foreignId });
    const res = await PATCH_CONV(jsonRequest("PATCH", { title: "attempt" }), { params });
    expect(res.status).toBe(404);
  });

  it("applies both title and folderId in combined update", async () => {
    const folder = await createFolder(userId, "combined");
    const conv = await createConversation(userId, "original");
    const params = Promise.resolve({ conversationId: conv.id });
    const res = await PATCH_CONV(jsonRequest("PATCH", { title: "renamed", folderId: folder.id }), { params });
    expect(res.status).toBe(204);
    const conversations = await listConversations(userId);
    const updated = conversations.find((c) => c.id === conv.id);
    expect(updated?.title).toBe("renamed");
    expect(updated?.folderId).toBe(folder.id);
  });

  it("404s on a foreign folder and 400s on malformed input", async () => {
    const foreign = await createFolder(`test-${randomUUID()}`, "not yours");
    const params = Promise.resolve({ folderId: foreign.id });
    expect((await PATCH_FOLDER(jsonRequest("PATCH", { name: "x" }), { params })).status).toBe(404);
    const bad = new Request("http://localhost/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect((await POST(bad)).status).toBe(400);
  });
});
