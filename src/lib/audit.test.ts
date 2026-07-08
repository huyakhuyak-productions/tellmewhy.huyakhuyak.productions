import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents, user } from "@/db/schema";
import { recordAudit, recordAuditDeduped, listAuditEventsForClient } from "./audit";

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

describe("audit — centralized recording and the client feed", () => {
  let clientId: string;
  let therapistId: string;
  let conversationId: string;

  beforeEach(() => {
    clientId = `test-${randomUUID()}`;
    therapistId = `test-${randomUUID()}`;
    conversationId = randomUUID();
  });

  describe("recordAudit", () => {
    it("inserts an event with ids and times only", async () => {
      await recordAudit({ clientId, therapistId, conversationId, action: "conversation_viewed" });
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.clientId, clientId));
      expect(rows).toHaveLength(1);
      expect(rows[0].therapistId).toBe(therapistId);
      expect(rows[0].conversationId).toBe(conversationId);
      expect(rows[0].action).toBe("conversation_viewed");
    });

    it("accepts an explicit createdAt override", async () => {
      const backdated = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await recordAudit({ clientId, therapistId: null, action: "link_invited", createdAt: backdated });
      const [row] = await db.select().from(auditEvents).where(eq(auditEvents.clientId, clientId));
      expect(row.createdAt.getTime()).toBe(backdated.getTime());
    });
  });

  describe("recordAuditDeduped", () => {
    it("skips the insert when an identical event exists within the dedupe window", async () => {
      await recordAuditDeduped({ clientId, therapistId, conversationId, action: "conversation_viewed" });
      await recordAuditDeduped({ clientId, therapistId, conversationId, action: "conversation_viewed" });

      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conversationId), eq(auditEvents.action, "conversation_viewed")));
      expect(rows).toHaveLength(1);
    });

    it("inserts again once a prior identical event falls outside the window (backdated row)", async () => {
      await recordAuditDeduped({ clientId, therapistId, conversationId, action: "conversation_viewed" });
      const [existing] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conversationId), eq(auditEvents.action, "conversation_viewed")));
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
      await db.update(auditEvents).set({ createdAt: twentyMinutesAgo }).where(eq(auditEvents.id, existing.id));

      await recordAuditDeduped({ clientId, therapistId, conversationId, action: "conversation_viewed" });

      const rows = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conversationId), eq(auditEvents.action, "conversation_viewed")));
      expect(rows).toHaveLength(2);
    });

    it("does not dedupe against a different conversation or a different therapist", async () => {
      await recordAuditDeduped({ clientId, therapistId, conversationId, action: "conversation_viewed" });
      const otherConversationId = randomUUID();
      const otherTherapistId = `test-${randomUUID()}`;
      await recordAuditDeduped({ clientId, therapistId, conversationId: otherConversationId, action: "conversation_viewed" });
      await recordAuditDeduped({ clientId, therapistId: otherTherapistId, conversationId, action: "conversation_viewed" });

      const rows = await db.select().from(auditEvents).where(eq(auditEvents.clientId, clientId));
      expect(rows).toHaveLength(3);
    });

    it("does not dedupe a different action against conversation_viewed", async () => {
      await recordAuditDeduped({ clientId, therapistId, conversationId, action: "conversation_viewed" });
      await recordAuditDeduped({ clientId, therapistId, conversationId, action: "review_marker_advanced" });

      const rows = await db.select().from(auditEvents).where(eq(auditEvents.clientId, clientId));
      expect(rows).toHaveLength(2);
    });
  });

  describe("listAuditEventsForClient", () => {
    it("returns only the given client's own events, joined with the therapist's display name", async () => {
      const therapistUser = await insertUser("Dr. Okafor");
      await recordAudit({ clientId, therapistId: therapistUser, conversationId, action: "grant_created" });

      const otherClientId = `test-${randomUUID()}`;
      await recordAudit({ clientId: otherClientId, therapistId: therapistUser, conversationId, action: "grant_created" });

      const events = await listAuditEventsForClient(clientId);
      expect(events).toHaveLength(1);
      expect(events[0].therapistName).toBe("Dr. Okafor");

      const otherEvents = await listAuditEventsForClient(otherClientId);
      expect(otherEvents).toHaveLength(1);
      expect(otherEvents[0].therapistId).toBe(therapistUser);
    });

    it("orders newest first and respects the limit", async () => {
      const therapistUser = await insertUser("Dr. Lin");
      for (const action of ["grant_created", "conversation_viewed", "review_marker_advanced"] as const) {
        await recordAudit({ clientId, therapistId: therapistUser, conversationId, action });
      }

      const limited = await listAuditEventsForClient(clientId, 2);
      expect(limited).toHaveLength(2);
      expect(limited[0].action).toBe("review_marker_advanced");
    });

    it("does not blow up when the event has no therapistId (e.g. a therapist-initiated invite not yet accepted)", async () => {
      await recordAudit({ clientId, therapistId: null, action: "link_invited" });
      const events = await listAuditEventsForClient(clientId);
      expect(events).toHaveLength(1);
      expect(events[0].therapistName).toBeNull();
    });
  });
});
