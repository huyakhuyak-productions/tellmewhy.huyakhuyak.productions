import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, sharingGrants, therapistLinks, user } from "@/db/schema";
import { NotFoundError } from "./errors";
import { acceptInvite, createInvite, getActiveLinkForClient, getActiveLinksForTherapist, revokeLink } from "./therapist-links";

async function insertUser(overrides: { name?: string; role?: string } = {}): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db.insert(user).values({
    id,
    name: overrides.name ?? id,
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: overrides.role ?? "client",
  });
  return id;
}

describe("therapist link lifecycle", () => {
  let clientId: string;
  let therapistId: string;

  beforeEach(() => {
    clientId = `test-${randomUUID()}`;
    therapistId = `test-${randomUUID()}`;
  });

  it("round-trips a client-initiated invite through acceptance", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    const result = await acceptInvite(token, therapistId);
    expect(result.linkId).toBe(linkId);

    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(row.status).toBe("active");
    expect(row.clientId).toBe(clientId);
    expect(row.therapistId).toBe(therapistId);
    expect(row.acceptedAt).not.toBeNull();
  });

  it("never stores the raw token, only its sha256 hash", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(row.inviteTokenHash).not.toBe(token);
    expect(row.inviteTokenHash).not.toContain(token);
    expect(row.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an expired token (createdAt older than 7 days)", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.update(therapistLinks).set({ createdAt: eightDaysAgo }).where(eq(therapistLinks.id, linkId));
    await expect(acceptInvite(token, therapistId)).rejects.toThrow();
  });

  it("keeps an expired invite in 'invited' status after rejection", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.update(therapistLinks).set({ createdAt: eightDaysAgo }).where(eq(therapistLinks.id, linkId));
    await expect(acceptInvite(token, therapistId)).rejects.toThrow();

    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(row.status).toBe("invited");
  });

  it("rejects a second use of the same token", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const anotherUser = `test-${randomUUID()}`;
    await expect(acceptInvite(token, anotherUser)).rejects.toThrow();
  });

  it("rejects self-acceptance", async () => {
    const { token } = await createInvite(clientId, "client");
    await expect(acceptInvite(token, clientId)).rejects.toThrow();
  });

  it("rejects a second client-initiated invite while one is already pending", async () => {
    await createInvite(clientId, "client");
    await expect(createInvite(clientId, "client")).rejects.toThrow();
  });

  it("rejects a new client-initiated invite while the client already has an active link", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    await expect(createInvite(clientId, "client")).rejects.toThrow();
  });

  it("rejects accepting a therapist-initiated invite when the client already has an active link (one-active-link rule at accept)", async () => {
    const firstTherapist = `test-${randomUUID()}`;
    const { token: firstToken } = await createInvite(clientId, "client");
    await acceptInvite(firstToken, firstTherapist);

    const secondTherapist = `test-${randomUUID()}`;
    const { linkId: secondLinkId, token: secondToken } = await createInvite(secondTherapist, "therapist");
    await expect(acceptInvite(secondToken, clientId)).rejects.toThrow();

    // Nothing flipped on the rejected link.
    const [secondRow] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, secondLinkId));
    expect(secondRow.status).toBe("invited");
    expect(secondRow.clientId).toBeNull();
  });

  it("upgrades the acceptor to therapist only when the invite was client-initiated", async () => {
    const clientUser = await insertUser({ role: "client" });
    const therapistUser = await insertUser({ role: "client" });
    const { token } = await createInvite(clientUser, "client");
    await acceptInvite(token, therapistUser);

    const [therapistRow] = await db.select().from(user).where(eq(user.id, therapistUser));
    expect(therapistRow.role).toBe("therapist");
    const [clientRow] = await db.select().from(user).where(eq(user.id, clientUser));
    expect(clientRow.role).toBe("client");
  });

  it("does not upgrade role when the invite was therapist-initiated", async () => {
    const therapistUser = await insertUser({ role: "therapist" });
    const clientUser = await insertUser({ role: "client" });
    const { token } = await createInvite(therapistUser, "therapist");
    await acceptInvite(token, clientUser);

    const [clientRow] = await db.select().from(user).where(eq(user.id, clientUser));
    expect(clientRow.role).toBe("client");
    const [therapistRow] = await db.select().from(user).where(eq(user.id, therapistUser));
    expect(therapistRow.role).toBe("therapist");
  });

  it("allows revocation by the client party", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    await revokeLink(linkId, clientId);
    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(row.status).toBe("revoked");
    expect(row.revokedAt).not.toBeNull();
  });

  it("allows revocation by the therapist party", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    await revokeLink(linkId, therapistId);
    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(row.status).toBe("revoked");
  });

  it("allows the initiator to revoke their own pending (not yet accepted) invite", async () => {
    const { linkId } = await createInvite(clientId, "client");
    await revokeLink(linkId, clientId);
    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(row.status).toBe("revoked");
  });

  it("rejects revocation by a stranger with NotFoundError", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const stranger = `test-${randomUUID()}`;
    await expect(revokeLink(linkId, stranger)).rejects.toThrow(NotFoundError);
  });

  it("hard-deletes sharing grants when a link is revoked", async () => {
    const { createConversation } = await import("./conversations");
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const conv = await createConversation(clientId, "Shared conversation");
    await db.insert(sharingGrants).values({ linkId, conversationId: conv.id });

    await revokeLink(linkId, clientId);

    const grants = await db.select().from(sharingGrants).where(eq(sharingGrants.linkId, linkId));
    expect(grants).toHaveLength(0);
  });

  it("audits link_invited and link_accepted with ids and times only", async () => {
    const { token } = await createInvite(clientId, "client");
    const invitedEvents = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "link_invited")));
    expect(invitedEvents).toHaveLength(1);
    expect(invitedEvents[0].therapistId).toBeNull();

    await acceptInvite(token, therapistId);
    const acceptedEvents = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "link_accepted")));
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0].therapistId).toBe(therapistId);
  });

  it("audits a therapist-initiated invite once the client is known (at accept time)", async () => {
    const { token } = await createInvite(therapistId, "therapist");
    const beforeAccept = await db.select().from(auditEvents).where(eq(auditEvents.therapistId, therapistId));
    expect(beforeAccept).toHaveLength(0);

    await acceptInvite(token, clientId);
    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.therapistId, therapistId)));
    expect(events.map((e) => e.action).sort()).toEqual(["link_accepted", "link_invited"]);
  });

  it("audits link_revoked", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    await revokeLink(linkId, clientId);
    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "link_revoked")));
    expect(events).toHaveLength(1);
  });

  it("returns the active link for a client with the therapist's display name, or null when none", async () => {
    expect(await getActiveLinkForClient(clientId)).toBeNull();
    const therapistUser = await insertUser({ name: "Dr. Rivera" });
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistUser);

    const link = await getActiveLinkForClient(clientId);
    expect(link).not.toBeNull();
    expect(link!.therapistId).toBe(therapistUser);
    expect(link!.therapistName).toBe("Dr. Rivera");
  });

  it("returns active links for a therapist with each client's display name", async () => {
    expect(await getActiveLinksForTherapist(therapistId)).toEqual([]);
    const clientUser = await insertUser({ name: "Jordan" });
    const { token } = await createInvite(therapistId, "therapist");
    await acceptInvite(token, clientUser);

    const links = await getActiveLinksForTherapist(therapistId);
    expect(links).toHaveLength(1);
    expect(links[0].clientId).toBe(clientUser);
    expect(links[0].clientName).toBe("Jordan");
  });

  it("excludes revoked and still-pending links from the active lookups", async () => {
    const therapistUser = await insertUser();
    const { linkId, token } = await createInvite(clientId, "client");
    expect(await getActiveLinkForClient(clientId)).toBeNull(); // still invited, not accepted
    await acceptInvite(token, therapistUser);
    await revokeLink(linkId, clientId);
    expect(await getActiveLinkForClient(clientId)).toBeNull();
  });

  // The one-active-link-per-client rule was previously check-then-write:
  // hasPendingOrActiveLink() reads, then a separate insert/update writes.
  // Two concurrent requests can both pass the read before either write lands.
  // A partial unique index on (client_id) WHERE status IN (invited, active)
  // closes that race structurally — these tests fire genuinely concurrent
  // requests (Promise.allSettled, no artificial ordering) and assert only
  // one ever wins, regardless of which one the database picks.
  it("lets only one of two truly concurrent client-initiated creates through", async () => {
    const results = await Promise.allSettled([
      createInvite(clientId, "client"),
      createInvite(clientId, "client"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
      /already has a pending or active therapist link/,
    );

    const rows = await db
      .select()
      .from(therapistLinks)
      .where(and(eq(therapistLinks.clientId, clientId), or(eq(therapistLinks.status, "invited"), eq(therapistLinks.status, "active"))));
    expect(rows).toHaveLength(1);
  });

  it("lets only one of two truly concurrent therapist-initiated accepts (different tokens, same client) through", async () => {
    const therapistA = `test-${randomUUID()}`;
    const therapistB = `test-${randomUUID()}`;
    const { token: tokenA } = await createInvite(therapistA, "therapist");
    const { token: tokenB } = await createInvite(therapistB, "therapist");

    const results = await Promise.allSettled([
      acceptInvite(tokenA, clientId),
      acceptInvite(tokenB, clientId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
      /already has a pending or active therapist link|Invite not found or already used/,
    );

    const activeLinks = await db
      .select()
      .from(therapistLinks)
      .where(and(eq(therapistLinks.clientId, clientId), eq(therapistLinks.status, "active")));
    expect(activeLinks).toHaveLength(1);
  });

  it("stamps the deferred link_invited audit row (therapist-initiated) with the invite's true createdAt, not accept time", async () => {
    const { linkId, token } = await createInvite(therapistId, "therapist");
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db.update(therapistLinks).set({ createdAt: threeDaysAgo }).where(eq(therapistLinks.id, linkId));

    await acceptInvite(token, clientId);

    const [invitedEvent] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.therapistId, therapistId), eq(auditEvents.action, "link_invited")));
    expect(invitedEvent.createdAt.getTime()).toBe(threeDaysAgo.getTime());
  });
});
