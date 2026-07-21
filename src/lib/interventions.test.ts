import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents, conversations, messages } from "@/db/schema";
import { createConversation, loadMessages, saveMessage } from "./conversations";
import { CryptoError, decryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError } from "./errors";
import { sendIntervention } from "./interventions";
import { grantConversation, revokeGrant } from "./sharing";
import { acceptInvite, createInvite } from "./therapist-links";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

describe("sendIntervention", () => {
  let clientId: string;
  let therapistId: string;

  beforeEach(async () => {
    clientId = await seedUser();
    therapistId = `test-${randomUUID()}`;
  });
  afterEach(cleanupSeededUsers);

  it("appears in the client's own message load as a labeled human, with the exact text sent", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);

    await sendIntervention(therapistId, conv.id, "Try grounding: name five things you can see.");

    const loaded = await loadMessages(conv.id, clientId);
    expect(loaded.map((m) => [m.sender, m.text])).toEqual([
      ["therapist", "Try grounding: name five things you can see."],
    ]);
  });

  it("lands as a child of the current active leaf and becomes the new leaf", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);
    const leafBefore = await saveMessage({ conversationId: conv.id, userId: clientId, sender: "client", text: "the current leaf" });

    const { id } = await sendIntervention(therapistId, conv.id, "I'm here.");

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    // Chains off the committed leaf, not stranded off the active path.
    expect(row.parentId).toBe(leafBefore.id);
    // And moves the conversation's active leaf onto itself.
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(conversation.activeLeafId).toBe(id);
  });

  it("stamps the message with the sending therapist's id as its author", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);

    const { id } = await sendIntervention(therapistId, conv.id, "hi");

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.authorId).toBe(therapistId);
  });

  it("stores a v1 ciphertext blob at the row that decrypts ONLY with the client's DEK", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);

    const { id } = await sendIntervention(therapistId, conv.id, "secret guidance");

    const [row] = await db.select().from(messages).where(eq(messages.id, id));
    expect(row.ciphertext).toMatch(/^v1\./);
    expect(row.sender).toBe("therapist");

    const clientDek = await getOrCreateUserDek(clientId);
    expect(decryptText(clientDek, row.ciphertext)).toBe("secret guidance");

    // Cross-key proof: the THERAPIST's own DEK must not decrypt a message
    // body, because message bodies (interventions included) belong to the
    // client's key domain, not the therapist's.
    const therapistDek = await getOrCreateUserDek(therapistId);
    expect(() => decryptText(therapistDek, row.ciphertext)).toThrow(CryptoError);
  });

  it("bumps the conversation's updatedAt", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);
    const [before] = await db.select().from(conversations).where(eq(conversations.id, conv.id));

    await new Promise((resolve) => setTimeout(resolve, 10));
    await sendIntervention(therapistId, conv.id, "hi");

    const [after] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("audits intervention_sent with ids and times only", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared");
    await grantConversation(clientId, conv.id);

    await sendIntervention(therapistId, conv.id, "hi");

    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.conversationId, conv.id), eq(auditEvents.action, "intervention_sent")));
    expect(events).toHaveLength(1);
    expect(events[0].clientId).toBe(clientId);
    expect(events[0].therapistId).toBe(therapistId);
  });

  it("refuses an ungranted conversation with NotFoundError, writing nothing", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Never shared");

    await expect(sendIntervention(therapistId, conv.id, "hi")).rejects.toThrow(NotFoundError);
    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows).toHaveLength(0);
  });

  it("refuses a conversation whose grant was revoked, through the public function", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared then revoked");
    await grantConversation(clientId, conv.id);
    await revokeGrant(clientId, conv.id);

    await expect(sendIntervention(therapistId, conv.id, "hi")).rejects.toThrow(NotFoundError);
  });

  it("refuses another therapist's granted conversation", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared with the real therapist");
    await grantConversation(clientId, conv.id);

    const otherTherapist = `test-${randomUUID()}`;
    await expect(sendIntervention(otherTherapist, conv.id, "hi")).rejects.toThrow(NotFoundError);
  });
});
