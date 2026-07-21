import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents, messages, sharingGrants } from "@/db/schema";
import { createConversation, saveMessage } from "./conversations";
import { NotFoundError, ValidationError } from "./errors";
import {
  getGrantStateForClient,
  grantConversation,
  listGrantedConversations,
  listGrantsForClient,
  requireGrantedConversation,
  revokeGrant,
} from "./sharing";
import { acceptInvite, createInvite, revokeLink } from "./therapist-links";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

describe("sharing grants — THE gate", () => {
  let clientId: string;
  let therapistId: string;

  beforeEach(async () => {
    clientId = await seedUser();
    therapistId = `test-${randomUUID()}`;
  });
  afterEach(cleanupSeededUsers);

  // The adversarial list is the contract for this module — every one of
  // these paths must resolve to a plain NotFoundError (or, where noted, a
  // distinct non-NotFoundError business error), never a hint about which
  // reason applied.
  describe("adversarial", () => {
    it("refuses an ungranted conversation", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Never shared");

      await expect(requireGrantedConversation(therapistId, conv.id)).rejects.toThrow(NotFoundError);
    });

    it("refuses a conversation that was granted and then revoked", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Granted then revoked");
      await grantConversation(clientId, conv.id);
      await expect(requireGrantedConversation(therapistId, conv.id)).resolves.toBeDefined();

      await revokeGrant(clientId, conv.id);
      await expect(requireGrantedConversation(therapistId, conv.id)).rejects.toThrow(NotFoundError);
    });

    it("refuses a grant that survives under a revoked link (defense in depth of the join itself)", async () => {
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Stale grant");
      // revokeLink cascades its grants away in the normal path; simulate a
      // grant row that somehow still exists under a now-revoked link, to
      // prove the gate's own `status = 'active'` condition — not just the
      // cascade — is what keeps this out.
      await revokeLink(linkId, clientId);
      await db.insert(sharingGrants).values({ linkId, conversationId: conv.id });

      await expect(requireGrantedConversation(therapistId, conv.id)).rejects.toThrow(NotFoundError);
    });

    it("refuses another therapist's granted conversation", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Shared with the real therapist");
      await grantConversation(clientId, conv.id);

      const otherTherapist = `test-${randomUUID()}`;
      await expect(requireGrantedConversation(otherTherapist, conv.id)).rejects.toThrow(NotFoundError);
    });

    it("refuses a corrupt grant row — conversation owned by client A but grant tied to client B's link", async () => {
      // Set up clientA with a conversation
      const clientA = await seedUser();
      const convOwnedByA = await createConversation(clientA, "Owned by A");

      // Set up clientB and therapist with an active link
      const clientB = `test-${randomUUID()}`;
      const therapistB = `test-${randomUUID()}`;
      const { linkId: linkBId, token } = await createInvite(clientB, "client");
      await acceptInvite(token, therapistB);

      // Manually insert a corrupt grant: conversation owned by A, but grant tied to B's link
      await db.insert(sharingGrants).values({ linkId: linkBId, conversationId: convOwnedByA.id });

      // TherapistB should not be able to access A's conversation despite the grant row
      await expect(requireGrantedConversation(therapistB, convOwnedByA.id)).rejects.toThrow(NotFoundError);

      // The corrupt row should not appear in listGrantedConversations
      const list = await listGrantedConversations(therapistB, clientB);
      expect(list.map((c) => c.id)).not.toContain(convOwnedByA.id);
    });

    it("refuses nonexistent ids", async () => {
      await expect(requireGrantedConversation(randomUUID(), randomUUID())).rejects.toThrow(NotFoundError);
    });

    it("refuses a grant attempt by a non-owner client", async () => {
      const owner = await seedUser();
      const conv = await createConversation(owner, "Not yours");
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);

      await expect(grantConversation(clientId, conv.id)).rejects.toThrow(NotFoundError);
    });

    it("refuses a grant with no active link, distinctly from NotFoundError", async () => {
      const conv = await createConversation(clientId, "Owned, no link yet");
      await expect(grantConversation(clientId, conv.id)).rejects.toThrow(ValidationError);
      await expect(grantConversation(clientId, conv.id)).rejects.not.toThrow(NotFoundError);
    });

    it("is idempotent on a double grant — one row, one audit event", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Granted twice");

      await grantConversation(clientId, conv.id);
      await grantConversation(clientId, conv.id);

      const rows = await db.select().from(sharingGrants).where(eq(sharingGrants.conversationId, conv.id));
      expect(rows).toHaveLength(1);
      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "grant_created")));
      expect(events).toHaveLength(1);
    });

    it("never surfaces an ungranted conversation's title through listGrantedConversations", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const granted = await createConversation(clientId, "Granted title");
      const secret = await createConversation(clientId, "Secret ungranted title");
      await grantConversation(clientId, granted.id);

      const list = await listGrantedConversations(therapistId, clientId);
      expect(list.map((c) => c.id)).toEqual([granted.id]);
      expect(list.map((c) => c.id)).not.toContain(secret.id);
      expect(JSON.stringify(list)).not.toContain("Secret ungranted title");
    });
  });

  describe("happy paths", () => {
    it("grants and reads back linkId/clientId through the gate", async () => {
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Sharing this");
      await grantConversation(clientId, conv.id);

      const result = await requireGrantedConversation(therapistId, conv.id);
      expect(result).toEqual({ linkId, clientId });
    });

    it("audits grant_created and grant_revoked with ids and times only", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Audited");
      await grantConversation(clientId, conv.id);

      const created = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "grant_created")));
      expect(created).toHaveLength(1);
      expect(created[0].clientId).toBe(clientId);
      expect(created[0].therapistId).toBe(therapistId);

      await revokeGrant(clientId, conv.id);
      const revoked = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "grant_revoked")));
      expect(revoked).toHaveLength(1);
    });

    it("revokeGrant is a no-op (no error, no audit) when nothing is granted", async () => {
      const conv = await createConversation(clientId, "Never granted");
      await expect(revokeGrant(clientId, conv.id)).resolves.toBeUndefined();
      const events = await db.select().from(auditEvents).where(eq(auditEvents.conversationId, conv.id));
      expect(events).toHaveLength(0);
    });

    it("revokeGrant refuses a non-owner client", async () => {
      const owner = await seedUser();
      const conv = await createConversation(owner, "Not yours either");
      await expect(revokeGrant(clientId, conv.id)).rejects.toThrow(NotFoundError);
    });

    it("computes messageCount, lastMessageAt, flaggedCount, and crisisCount from the client's messages", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "With activity");
      await grantConversation(clientId, conv.id);

      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "hello" });
      const crisisMsg = await saveMessage({
        conversationId: conv.id,
        userId: clientId,
        sender: "client",
        text: "struggling",
        riskLevel: "crisis",
      });
      await db.update(messages).set({ flaggedAt: new Date() }).where(eq(messages.id, crisisMsg.id));

      const [summary] = await listGrantedConversations(therapistId, clientId);
      expect(summary.messageCount).toBe(3);
      expect(summary.flaggedCount).toBe(1);
      expect(summary.crisisCount).toBe(1);
      expect(summary.lastMessageAt).not.toBeNull();
    });

    it("returns zeroed stats and no crash for a granted conversation with no messages yet", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Empty");
      await grantConversation(clientId, conv.id);

      const [summary] = await listGrantedConversations(therapistId, clientId);
      expect(summary.messageCount).toBe(0);
      expect(summary.flaggedCount).toBe(0);
      expect(summary.crisisCount).toBe(0);
      expect(summary.lastMessageAt).toBeNull();
    });

    it("reflects the current grant state for a client", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const conv = await createConversation(clientId, "Toggled");

      expect(await getGrantStateForClient(clientId, conv.id)).toBe(false);
      await grantConversation(clientId, conv.id);
      expect(await getGrantStateForClient(clientId, conv.id)).toBe(true);
      await revokeGrant(clientId, conv.id);
      expect(await getGrantStateForClient(clientId, conv.id)).toBe(false);
    });

    it("lists granted conversation ids for a client", async () => {
      const { token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      const a = await createConversation(clientId, "A");
      const b = await createConversation(clientId, "B");
      await grantConversation(clientId, a.id);

      expect(await listGrantsForClient(clientId)).toEqual([a.id]);
      await grantConversation(clientId, b.id);
      expect(await listGrantsForClient(clientId)).toEqual(expect.arrayContaining([a.id, b.id]));
    });
  });
});
