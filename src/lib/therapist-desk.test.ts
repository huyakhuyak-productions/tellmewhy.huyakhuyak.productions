import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents, user } from "@/db/schema";
import { createConversation, flagMessageForTherapist, saveMessage, setConversationHidden } from "./conversations";
import { sendIntervention } from "./interventions";
import { advanceReviewMarker } from "./therapist-access";
import { acceptInvite, createInvite } from "./therapist-links";
import {
  getClientConversations,
  getReadingView,
  getTherapistClientLinks,
  listAttentionQueue,
  listClientOverviews,
} from "./therapist-desk";
import { grantConversation, listGrantedConversations } from "./sharing";

async function insertUser(name: string): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: "client",
  });
  return id;
}

// Client-initiated invite → therapist accepts → an active link with the
// acceptor promoted to the therapist role.
async function link(clientId: string, therapistId: string): Promise<void> {
  const { token } = await createInvite(clientId, "client");
  await acceptInvite(token, therapistId);
}

describe("therapist desk — composed reads", () => {
  let clientId: string;
  let therapistId: string;

  beforeEach(async () => {
    clientId = await insertUser("Robin Client");
    therapistId = await insertUser("Dr. Vale");
  });

  describe("getTherapistClientLinks", () => {
    it("returns active clients with a linked-since date, none before linking", async () => {
      expect(await getTherapistClientLinks(therapistId)).toEqual([]);
      await link(clientId, therapistId);
      const links = await getTherapistClientLinks(therapistId);
      expect(links).toHaveLength(1);
      expect(links[0].clientId).toBe(clientId);
      expect(links[0].clientName).toBe("Robin Client");
      expect(links[0].linkedSince).toBeInstanceOf(Date);
    });
  });

  describe("listClientOverviews", () => {
    it("counts shared conversations and rolls up crisis/flag badges", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Nights");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });
      await saveMessage({
        conversationId: conv.id,
        userId: clientId,
        sender: "client",
        text: "hard night",
        riskLevel: "crisis",
      });
      const flagged = await saveMessage({
        conversationId: conv.id,
        userId: clientId,
        sender: "client",
        text: "please read this",
      });
      await flagMessageForTherapist(clientId, flagged.id);

      const [overview] = await listClientOverviews(therapistId);
      expect(overview.sharedCount).toBe(1);
      expect(overview.crisisCount).toBe(1);
      expect(overview.flagCount).toBe(1);
    });

    it("orders clients with crises ahead of the calm ones", async () => {
      const calmClient = await insertUser("Calm");
      await link(clientId, therapistId);
      await link(calmClient, therapistId);

      const hot = await createConversation(clientId, "Hot");
      await grantConversation(clientId, hot.id);
      await saveMessage({
        conversationId: hot.id,
        userId: clientId,
        sender: "client",
        text: "crisis",
        riskLevel: "crisis",
      });

      const calm = await createConversation(calmClient, "Calm chat");
      await grantConversation(calmClient, calm.id);
      await saveMessage({ conversationId: calm.id, userId: calmClient, sender: "client", text: "ok" });

      const overviews = await listClientOverviews(therapistId);
      expect(overviews.map((o) => o.clientName)).toEqual(["Robin Client", "Calm"]);
    });
  });

  describe("listAttentionQueue", () => {
    it("enriches each item with the client name and conversation title", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "The title");
      await grantConversation(clientId, conv.id);
      await saveMessage({
        conversationId: conv.id,
        userId: clientId,
        sender: "client",
        text: "a crisis line",
        riskLevel: "crisis",
      });

      const queue = await listAttentionQueue(therapistId);
      expect(queue).toHaveLength(1);
      expect(queue[0].clientName).toBe("Robin Client");
      expect(queue[0].conversationTitle).toBe("The title");
      expect(queue[0].kind).toBe("crisis");
    });

    it("is empty when nothing is flagged or in crisis", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Calm");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "fine" });
      expect(await listAttentionQueue(therapistId)).toEqual([]);
    });
  });

  describe("getClientConversations", () => {
    it("counts every message as unread when nothing is reviewed yet", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Fresh");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "one" });
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "two" });

      const view = await getClientConversations(therapistId, clientId);
      expect(view.clientName).toBe("Robin Client");
      expect(view.conversations).toHaveLength(1);
      expect(view.conversations[0].unreadCount).toBe(2);
    });

    it("counts only messages after the review marker", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Marked");
      await grantConversation(clientId, conv.id);
      const first = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "one" });
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "two" });
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "three" });

      await advanceReviewMarker(therapistId, conv.id, first.id);
      const view = await getClientConversations(therapistId, clientId);
      expect(view.conversations[0].unreadCount).toBe(2);
    });

    it("counts messages created after the marker regardless of which branch they land on (time-based, branch-stable)", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Branched unread");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "m1" });
      const m2 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "m2" });
      // Two branches off m2 — both created strictly after m2.
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "branch A", parentId: m2.id });
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "branch B", parentId: m2.id });

      await advanceReviewMarker(therapistId, conv.id, m2.id);
      const view = await getClientConversations(therapistId, clientId);
      // branchA + branchB were both created after m2 → 2 unread, independent of
      // which branch is active. (m1 predates the marker; m2 is the marker.)
      expect(view.conversations[0].unreadCount).toBe(2);
    });

    it("keeps a hidden conversation fully visible in getClientConversations (hide changes nothing therapist-visible)", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Hidden but shared");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "one" });
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "two" });

      const before = await getClientConversations(therapistId, clientId);
      await setConversationHidden(conv.id, clientId, true);
      const after = await getClientConversations(therapistId, clientId);
      // Direct before/after equality: no therapist surface may filter on hiddenAt.
      expect(after).toEqual(before);
    });

    it("returns an empty list for a client with no active link", async () => {
      const stranger = await insertUser("Stranger");
      const view = await getClientConversations(therapistId, stranger);
      expect(view).toEqual({ clientName: null, linkedSince: null, conversations: [] });
    });
  });

  describe("hide-blindness (adversarial)", () => {
    it("keeps a hidden conversation in listGrantedConversations, byte-for-byte", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Hidden grant");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });

      const before = await listGrantedConversations(therapistId, clientId);
      await setConversationHidden(conv.id, clientId, true);
      const after = await listGrantedConversations(therapistId, clientId);
      expect(after).toEqual(before);
      expect(after.map((c) => c.id)).toContain(conv.id);
    });
  });

  describe("getReadingView", () => {
    it("returns messages, the marker, therapist author names, and title", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Reading");
      await grantConversation(clientId, conv.id);
      const m1 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hello" });
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "hi there" });
      await sendIntervention(therapistId, conv.id, "I'm here with you.");
      await advanceReviewMarker(therapistId, conv.id, m1.id);

      const view = await getReadingView(therapistId, conv.id);
      expect(view.clientName).toBe("Robin Client");
      expect(view.conversationTitle).toBe("Reading");
      expect(view.markerMessageId).toBe(m1.id);
      const therapistMsg = view.messages.find((m) => m.sender === "therapist");
      expect(therapistMsg?.authorName).toBe("Dr. Vale");
      expect(therapistMsg?.text).toBe("I'm here with you.");
    });

    it("exposes the active leaf and the WHOLE tree (both branches), each message carrying its parentId", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Tree reading");
      await grantConversation(clientId, conv.id);
      const m1 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "root" });
      const m2 = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "ai", text: "reply" });
      const branchA = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "branch A", parentId: m2.id });
      const branchB = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "branch B", parentId: m2.id });

      const view = await getReadingView(therapistId, conv.id);
      // The latest child of m2 is the active leaf.
      expect(view.activeLeafId).toBe(branchB.id);
      // The whole tree is returned, not just the active path.
      expect(view.messages.map((m) => m.id).sort()).toEqual([m1.id, m2.id, branchA.id, branchB.id].sort());
      const byId = new Map(view.messages.map((m) => [m.id, m]));
      expect(byId.get(branchA.id)!.parentId).toBe(m2.id);
      expect(byId.get(branchB.id)!.parentId).toBe(m2.id);
      expect(byId.get(m1.id)!.parentId).toBeNull();
    });

    it("audits the view as a conversation_viewed (a view is a view)", async () => {
      await link(clientId, therapistId);
      const conv = await createConversation(clientId, "Audited");
      await grantConversation(clientId, conv.id);
      await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "hi" });

      await getReadingView(therapistId, conv.id);
      const events = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "conversation_viewed")));
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});
