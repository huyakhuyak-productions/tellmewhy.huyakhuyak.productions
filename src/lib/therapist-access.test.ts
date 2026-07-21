import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { auditEvents, messages, reviewMarkers, user } from "@/db/schema";
import { createConversation, saveMessage, setConversationHidden } from "./conversations";
import { NotFoundError } from "./errors";
import { grantConversation, requireGrantedConversation, revokeGrant } from "./sharing";
import {
  advanceReviewMarker,
  getReviewMarkerForClient,
  listAttentionItems,
  loadSharedMessages,
} from "./therapist-access";
import { acceptInvite, createInvite } from "./therapist-links";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

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

describe("therapist access — reads, review line, attention queue", () => {
  let clientId: string;
  let therapistId: string;

  beforeEach(async () => {
    clientId = await seedUser();
    therapistId = `test-${randomUUID()}`;
  });
  afterEach(cleanupSeededUsers);

  describe("loadSharedMessages", () => {
    it("decrypts a granted conversation's messages via the client's DEK", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Shared");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hello" });
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "hi there" });

      const loaded = await loadSharedMessages(therapistId, conv.id);
      expect(loaded.map((m) => [m.sender, m.text])).toEqual([
        ["client", "hello"],
        ["ai", "hi there"],
      ]);
    });

    it("returns BOTH branches (whole tree) after a client edits mid-conversation, each carrying its parentId", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Branched");
      await grantConversation(clientId, conv.id);
      const m1 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "root" });
      const m2 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "reply" });
      // A client edit branches at m2: two children sharing the same parent.
      const branchA = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "branch A", parentId: m2.id });
      const branchB = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "branch B", parentId: m2.id });

      const loaded = await loadSharedMessages(therapistId, conv.id);
      const byId = new Map(loaded.map((m) => [m.id, m]));
      // The whole tree is present — neither branch is filtered out by a path.
      expect(loaded.map((m) => m.text).sort()).toEqual(["branch A", "branch B", "reply", "root"]);
      expect(byId.get(m1.id)!.parentId).toBeNull();
      expect(byId.get(m2.id)!.parentId).toBe(m1.id);
      expect(byId.get(branchA.id)!.parentId).toBe(m2.id);
      expect(byId.get(branchB.id)!.parentId).toBe(m2.id);
    });

    it("still loads a HIDDEN conversation and still passes the gate (therapist surfaces ignore hiddenAt)", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Hidden by the client");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "still visible to the therapist" });

      const before = await loadSharedMessages(therapistId, conv.id);
      await setConversationHidden(conv.id, clientId, true);
      // The gate must not care about hiddenAt.
      await expect(requireGrantedConversation(therapistId, conv.id)).resolves.toMatchObject({ clientId });
      const after = await loadSharedMessages(therapistId, conv.id);
      expect(after.map((m) => m.text)).toEqual(before.map((m) => m.text));
      expect(after).toHaveLength(1);
    });

    it("refuses an ungranted conversation with NotFoundError", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Never shared");

      await expect(loadSharedMessages(therapistId, conv.id)).rejects.toThrow(NotFoundError);
    });

    it("refuses a conversation whose grant was revoked, through the public function", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Revoked");
      await grantConversation(clientId, conv.id);
      await expect(loadSharedMessages(therapistId, conv.id)).resolves.toBeDefined();

      await revokeGrant(clientId, conv.id);
      await expect(loadSharedMessages(therapistId, conv.id)).rejects.toThrow(NotFoundError);
    });

    it("skips a message with corrupted ciphertext instead of failing the whole read", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Mixed health");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "good" });
      const corrupt = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "bad" });
      await db.update(messages).set({ ciphertext: "not-valid-ciphertext" }).where(eq(messages.id, corrupt.id));

      const loaded = await loadSharedMessages(therapistId, conv.id);
      expect(loaded.map((m) => m.text)).toEqual(["good"]);
      consoleErrorSpy.mockRestore();
    });

    it("audits conversation_viewed once per read", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Audited read");
      await grantConversation(clientId, conv.id);

      await loadSharedMessages(therapistId, conv.id);

      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "conversation_viewed")));
      expect(events).toHaveLength(1);
      expect(events[0].clientId).toBe(clientId);
      expect(events[0].therapistId).toBe(therapistId);
    });

    it("dedupes conversation_viewed within 15 minutes but records again once the prior view is backdated past the window", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Repeated read");
      await grantConversation(clientId, conv.id);

      await loadSharedMessages(therapistId, conv.id);
      await loadSharedMessages(therapistId, conv.id);
      let events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "conversation_viewed")));
      expect(events).toHaveLength(1);

      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
      await db.update(auditEvents).set({ createdAt: twentyMinutesAgo }).where(eq(auditEvents.id, events[0]!.id));

      await loadSharedMessages(therapistId, conv.id);
      events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "conversation_viewed")));
      expect(events).toHaveLength(2);
    });
  });

  describe("advanceReviewMarker / getReviewMarkerForClient", () => {
    it("upserts a review marker and audits review_marker_advanced (not deduped)", async () => {
      const therapistUser = await insertUser("Dr. Sable");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      const conv = await createConversation(clientId, "Reviewed");
      await grantConversation(clientId, conv.id);
      const msg = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });

      await advanceReviewMarker(therapistUser, conv.id, msg.id);
      const marker = await getReviewMarkerForClient(clientId, conv.id);
      expect(marker).toEqual({ lastReviewedMessageId: msg.id, therapistName: "Dr. Sable", updatedAt: expect.any(Date) });

      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "review_marker_advanced")));
      expect(events).toHaveLength(1);

      // A second advance is not deduped — each is a distinct, meaningful event.
      const msg2 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "again" });
      await advanceReviewMarker(therapistUser, conv.id, msg2.id);
      const events2 = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "review_marker_advanced")));
      expect(events2).toHaveLength(2);

      const rows = await db.select().from(reviewMarkers).where(eq(reviewMarkers.conversationId, conv.id));
      expect(rows).toHaveLength(1); // upsert, not a second row
      expect(rows[0].lastReviewedMessageId).toBe(msg2.id);
    });

    it("accepts a review marker on an INACTIVE branch (any message of the conversation, not just the active path)", async () => {
      const therapistUser = await insertUser("Dr. Reyes");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      const conv = await createConversation(clientId, "Branched review");
      await grantConversation(clientId, conv.id);
      const m1 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "root" });
      const inactive = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "superseded branch", parentId: m1.id });
      // A later sibling becomes the active leaf, leaving `inactive` off the path.
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "active branch", parentId: m1.id });

      await advanceReviewMarker(therapistUser, conv.id, inactive.id);
      const marker = await getReviewMarkerForClient(clientId, conv.id);
      expect(marker!.lastReviewedMessageId).toBe(inactive.id);
    });

    it("rejects a message that belongs to a DIFFERENT conversation", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Conversation A");
      const otherConv = await createConversation(clientId, "Conversation B");
      await grantConversation(clientId, conv.id);
      await grantConversation(clientId, otherConv.id);
      const foreignMsg = await saveMessage({ conversationId: otherConv.id, userId: clientId, sender: "client", text: "wrong conv" });

      await expect(advanceReviewMarker(therapistId, conv.id, foreignMsg.id)).rejects.toThrow(NotFoundError);
    });

    it("refuses an ungranted conversation", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Never shared");
      const msg = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });

      await expect(advanceReviewMarker(therapistId, conv.id, msg.id)).rejects.toThrow(NotFoundError);
    });

    it("returns null for the client's divider when there is no marker yet", async () => {
      const conv = await createConversation(clientId, "No marker yet");
      expect(await getReviewMarkerForClient(clientId, conv.id)).toBeNull();
    });

    it("hides the marker when the grant alone is revoked (link stays active), and restores it on re-grant", async () => {
      const therapistUser = await insertUser("Dr. Ilse");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      const conv = await createConversation(clientId, "Grant-only revoke");
      await grantConversation(clientId, conv.id);
      const msg = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });
      await advanceReviewMarker(therapistUser, conv.id, msg.id);
      expect(await getReviewMarkerForClient(clientId, conv.id)).not.toBeNull();

      // Revoke only the GRANT — the link stays active. The divider is an
      // indirect surface of shared data and must obey the gate too.
      await revokeGrant(clientId, conv.id);
      expect(await getReviewMarkerForClient(clientId, conv.id)).toBeNull();

      // The marker row itself persists — re-granting restores the divider.
      // Revocation hides, re-grant restores: that's the designed semantic.
      await grantConversation(clientId, conv.id);
      const restored = await getReviewMarkerForClient(clientId, conv.id);
      expect(restored).not.toBeNull();
      expect(restored!.lastReviewedMessageId).toBe(msg.id);
    });

    it("hides the marker once the link is revoked", async () => {
      const therapistUser = await insertUser("Dr. Vance");
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      const conv = await createConversation(clientId, "Marker then revoke");
      await grantConversation(clientId, conv.id);
      const msg = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });
      await advanceReviewMarker(therapistUser, conv.id, msg.id);
      expect(await getReviewMarkerForClient(clientId, conv.id)).not.toBeNull();

      const { revokeLink } = await import("./therapist-links");
      await revokeLink(linkId, clientId);
      expect(await getReviewMarkerForClient(clientId, conv.id)).toBeNull();
    });
  });

  describe("listAttentionItems", () => {
    it("surfaces crisis and flagged messages across all granted conversations, crisis first then flags, newest first within groups", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Attention");
      await grantConversation(clientId, conv.id);

      const flag1 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "flag one" });
      await db.update(messages).set({ flaggedAt: new Date(Date.now() - 3000) }).where(eq(messages.id, flag1.id));
      const flag2 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "flag two" });
      await db.update(messages).set({ flaggedAt: new Date(Date.now() - 1000) }).where(eq(messages.id, flag2.id));
      const crisis1 = await saveMessage({
        conversationId: conv.id,
        userId: clientId,
        sender: "client",
        text: "crisis one",
        riskLevel: "crisis",
      });
      await db.update(messages).set({ createdAt: new Date(Date.now() - 4000) }).where(eq(messages.id, crisis1.id));
      const crisis2 = await saveMessage({
        conversationId: conv.id,
        userId: clientId,
        sender: "client",
        text: "crisis two",
        riskLevel: "crisis",
      });
      await db.update(messages).set({ createdAt: new Date(Date.now() - 2000) }).where(eq(messages.id, crisis2.id));

      const items = await listAttentionItems(therapistId);
      expect(items.map((i) => i.messageId)).toEqual([crisis2.id, crisis1.id, flag2.id, flag1.id]);
      expect(items.map((i) => i.kind)).toEqual(["crisis", "crisis", "flag", "flag"]);
      expect(items.every((i) => i.excerpt.length > 0)).toBe(true);
    });

    it("caps decrypted excerpts at 140 code points", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Long crisis message");
      await grantConversation(clientId, conv.id);
      const longText = "a".repeat(300);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: longText, riskLevel: "crisis" });

      const items = await listAttentionItems(therapistId);
      expect(items).toHaveLength(1);
      expect([...items[0]!.excerpt]).toHaveLength(140);
    });

    it("structurally omits an ungranted crisis message (adversarial)", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const grantedConv = await createConversation(clientId, "Granted");
      await grantConversation(clientId, grantedConv.id);
      const ungrantedConv = await createConversation(clientId, "Ungranted crisis");
      const hiddenCrisis = await saveMessage({
        conversationId: ungrantedConv.id,
        userId: clientId,
        sender: "client",
        text: "hidden crisis",
        riskLevel: "crisis",
      });

      const items = await listAttentionItems(therapistId);
      expect(items.map((i) => i.messageId)).not.toContain(hiddenCrisis.id);
      expect(JSON.stringify(items)).not.toContain("hidden crisis");
    });

    it("omits a crisis message after the grant is revoked", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Revoked crisis");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "will be hidden", riskLevel: "crisis" });
      expect(await listAttentionItems(therapistId)).toHaveLength(1);

      await revokeGrant(clientId, conv.id);
      expect(await listAttentionItems(therapistId)).toHaveLength(0);
    });

    it("returns an empty list for a therapist with no granted conversations", async () => {
      expect(await listAttentionItems(therapistId)).toEqual([]);
    });

    it("skips a corrupted message instead of failing the whole queue", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Corrupt attention");
      await grantConversation(clientId, conv.id);
      const corrupt = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "bad", riskLevel: "crisis" });
      await db.update(messages).set({ ciphertext: "not-valid-ciphertext" }).where(eq(messages.id, corrupt.id));

      const items = await listAttentionItems(therapistId);
      expect(items).toEqual([]);
      consoleErrorSpy.mockRestore();
    });

    it("audits attention_viewed once (deduped) when there are flagged/crisis items", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Flagged for attention");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "help", riskLevel: "crisis" });

      await listAttentionItems(therapistId);
      await listAttentionItems(therapistId);

      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "attention_viewed")));
      expect(events).toHaveLength(1);
      expect(events[0].therapistId).toBe(therapistId);
      expect(events[0].conversationId).toBeNull();
      expect(events[0].actorId).toBe(therapistId);
    });

    it("does not audit attention_viewed when there is nothing to flag", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Nothing flagged");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "just chatting" });

      const items = await listAttentionItems(therapistId);
      expect(items).toEqual([]);

      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "attention_viewed")));
      expect(events).toHaveLength(0);
    });

    it("never audits attention_viewed for a client whose crisis message is structurally ungranted (adversarial)", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const grantedConv = await createConversation(clientId, "Granted");
      await grantConversation(clientId, grantedConv.id);
      const otherClientId = await seedUser();
      const ungrantedConv = await createConversation(otherClientId, "Ungranted crisis, different client");
      await saveMessage({ conversationId: ungrantedConv.id, userId: otherClientId, sender: "client", text: "hidden crisis", riskLevel: "crisis" });

      await listAttentionItems(therapistId);

      const otherEvents = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, otherClientId), eq(auditEvents.action, "attention_viewed")));
      expect(otherEvents).toHaveLength(0);
    });
  });
});
