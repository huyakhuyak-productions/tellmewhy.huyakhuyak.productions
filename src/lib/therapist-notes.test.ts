import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents, notes, user } from "@/db/schema";
import { createConversation } from "./conversations";
import { CryptoError, decryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import { grantConversation, revokeGrant } from "./sharing";
import {
  createNote,
  getActiveAiInstruction,
  listNotesForTherapist,
  listPublicNotesForClient,
} from "./therapist-notes";
import { acceptInvite, createInvite, revokeLink } from "./therapist-links";

async function insertUser(name: string): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: "therapist",
  });
  return id;
}

describe("therapist notes — author-owned, client-boundaried", () => {
  let clientId: string;
  let therapistId: string;

  beforeEach(() => {
    clientId = `test-${randomUUID()}`;
    therapistId = `test-${randomUUID()}`;
  });

  describe("createNote — key ownership and boundaries", () => {
    it("encrypts the body with the THERAPIST's DEK — a v1 blob that decrypts only with it", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);

      const { id } = await createNote(therapistId, clientId, { conversationId: conv.id, kind: "private", body: "watch for avoidance" });

      const [row] = await db.select().from(notes).where(eq(notes.id, id));
      expect(row.bodyCiphertext).toMatch(/^v1\./);

      const therapistDek = await getOrCreateUserDek(therapistId);
      expect(decryptText(therapistDek, row.bodyCiphertext)).toBe("watch for avoidance");

      // Cross-key proof: note bodies belong to the THERAPIST's key domain —
      // the client's own DEK must not decrypt them.
      const clientDek = await getOrCreateUserDek(clientId);
      expect(() => decryptText(clientDek, row.bodyCiphertext)).toThrow(CryptoError);
    });

    it("increments ai_instruction version 1, 2, 3 for the same link, conversation-scoped or not", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);

      const v1 = await createNote(therapistId, clientId, { conversationId: conv.id, kind: "ai_instruction", body: "be gentle" });
      const v2 = await createNote(therapistId, clientId, { kind: "ai_instruction", body: "be gentle, follow up on sleep" });
      const v3 = await createNote(therapistId, clientId, { conversationId: conv.id, kind: "ai_instruction", body: "sleep resolved, focus on work stress" });

      expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    });

    it("does not version private or public notes past 1", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);

      const a = await createNote(therapistId, clientId, { conversationId: conv.id, kind: "private", body: "first" });
      const b = await createNote(therapistId, clientId, { conversationId: conv.id, kind: "private", body: "second" });
      expect([a.version, b.version]).toEqual([1, 1]);
    });

    it("audits note_published ONLY for kind public — private and ai_instruction leave no audit row", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);

      await createNote(therapistId, clientId, { conversationId: conv.id, kind: "private", body: "private note" });
      await createNote(therapistId, clientId, { conversationId: conv.id, kind: "ai_instruction", body: "instruction" });
      await createNote(therapistId, clientId, { conversationId: conv.id, kind: "public", body: "public note" });

      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "note_published")));
      expect(events).toHaveLength(1);
      expect(events[0].clientId).toBe(clientId);
      expect(events[0].therapistId).toBe(therapistId);
    });

    it("refuses createNote on an ungranted conversation with NotFoundError, writing nothing", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Never shared");

      await expect(createNote(therapistId, clientId, { conversationId: conv.id, kind: "private", body: "x" })).rejects.toThrow(
        NotFoundError,
      );
      const rows = await db.select().from(notes);
      expect(rows.map((r) => r.conversationId)).not.toContain(conv.id);
    });

    it("refuses a conversation gated to a DIFFERENT client than the clientId passed", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Shared with real client");
      await grantConversation(clientId, conv.id);

      const impersonatedClientId = `test-${randomUUID()}`;
      await expect(
        createNote(therapistId, impersonatedClientId, { conversationId: conv.id, kind: "private", body: "x" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("refuses a client-scoped note when the therapist has no active link with that client", async () => {
      await expect(createNote(therapistId, clientId, { kind: "private", body: "x" })).rejects.toThrow(NotFoundError);
    });

    it("refuses a client-scoped note once the link is revoked", async () => {
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await revokeLink(linkId, clientId);

      await expect(createNote(therapistId, clientId, { kind: "private", body: "x" })).rejects.toThrow(NotFoundError);
    });
  });

  describe("listNotesForTherapist — the author's own view", () => {
    it("returns all three kinds, decrypted, newest first, with every instruction version visible", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);

      await createNote(therapistId, clientId, { conversationId: conv.id, kind: "private", body: "private one" });
      await createNote(therapistId, clientId, { kind: "ai_instruction", body: "instruction v1" });
      await createNote(therapistId, clientId, { kind: "ai_instruction", body: "instruction v2" });
      await createNote(therapistId, clientId, { conversationId: conv.id, kind: "public", body: "public one" });

      const list = await listNotesForTherapist(therapistId, clientId);
      expect(list.map((n) => n.kind).sort()).toEqual(["ai_instruction", "ai_instruction", "private", "public"]);
      const instructions = list.filter((n) => n.kind === "ai_instruction");
      expect(instructions.map((n) => n.version).sort()).toEqual([1, 2]);
      expect(instructions.map((n) => n.body).sort()).toEqual(["instruction v1", "instruction v2"]);
      // Newest first.
      expect(list[0]!.body).toBe("public one");
    });

    it("never mixes in another client's notes", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await createNote(therapistId, clientId, { kind: "private", body: "about this client" });

      const otherClientId = `test-${randomUUID()}`;
      const { token: otherToken } = await createInvite(otherClientId, "client");
      await acceptInvite(otherToken, therapistId);
      await createNote(therapistId, otherClientId, { kind: "private", body: "about the other client" });

      const list = await listNotesForTherapist(therapistId, clientId);
      expect(list).toHaveLength(1);
      expect(list[0]!.body).toBe("about this client");
    });

    it("returns an empty list when the therapist has never linked with this client", async () => {
      expect(await listNotesForTherapist(therapistId, clientId)).toEqual([]);
    });
  });

  describe("listPublicNotesForClient — adversarial kind isolation", () => {
    it("returns ONLY public notes — private and ai_instruction never appear, structurally or in content", async () => {
      const therapistUser = await insertUser("Dr. Kade");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);

      await createNote(therapistUser, clientId, { conversationId: conv.id, kind: "private", body: "SECRET clinical note" });
      await createNote(therapistUser, clientId, { kind: "ai_instruction", body: "SECRET steering instruction" });
      await createNote(therapistUser, clientId, { conversationId: conv.id, kind: "public", body: "You're making progress" });

      const conversationScoped = await listPublicNotesForClient(clientId, conv.id);
      expect(conversationScoped).toHaveLength(1);
      expect(conversationScoped[0]!.body).toBe("You're making progress");
      // API shape check: no `kind` field exists at all on the returned type,
      // so a private/ai_instruction note could never be mistaken for public.
      expect(conversationScoped[0]).not.toHaveProperty("kind");
      expect(JSON.stringify(conversationScoped)).not.toContain("SECRET");
    });

    it("shows client-scoped public notes when conversationId is null, and keeps them separate from conversation-scoped ones", async () => {
      const therapistUser = await insertUser("Dr. Reyes");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);

      await createNote(therapistUser, clientId, { conversationId: conv.id, kind: "public", body: "conversation-scoped public" });
      await createNote(therapistUser, clientId, { kind: "public", body: "client-scoped public" });

      const clientScoped = await listPublicNotesForClient(clientId, null);
      expect(clientScoped.map((n) => n.body)).toEqual(["client-scoped public"]);
      expect(clientScoped[0]!.therapistName).toBe("Dr. Reyes");

      const conversationScoped = await listPublicNotesForClient(clientId, conv.id);
      expect(conversationScoped.map((n) => n.body)).toEqual(["conversation-scoped public"]);
    });

    it("DECISION: keeps public notes visible after the grant is revoked", async () => {
      const therapistUser = await insertUser("Dr. Nkemdirim");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);
      await createNote(therapistUser, clientId, { conversationId: conv.id, kind: "public", body: "already said" });

      await revokeGrant(clientId, conv.id);

      const list = await listPublicNotesForClient(clientId, conv.id);
      expect(list.map((n) => n.body)).toEqual(["already said"]);
    });

    it("DECISION: keeps public notes visible after the link itself is revoked", async () => {
      const therapistUser = await insertUser("Dr. Osei");
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      await createNote(therapistUser, clientId, { kind: "public", body: "client-scoped, said before revoke" });

      await revokeLink(linkId, clientId);

      const list = await listPublicNotesForClient(clientId, null);
      expect(list.map((n) => n.body)).toEqual(["client-scoped, said before revoke"]);
    });
  });

  describe("getActiveAiInstruction — server-internal", () => {
    it("returns the latest version's decrypted body", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await createNote(therapistId, clientId, { kind: "ai_instruction", body: "v1 instruction" });
      const created = await createNote(therapistId, clientId, { kind: "ai_instruction", body: "v2 instruction" });

      const [linkRow] = await db.select().from(notes).where(eq(notes.id, created.id));
      const instruction = await getActiveAiInstruction(linkRow.linkId);
      expect(instruction).toBe("v2 instruction");
    });

    it("returns null when no ai_instruction exists for the link", async () => {
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      expect(await getActiveAiInstruction(linkId)).toBeNull();
    });
  });
});
