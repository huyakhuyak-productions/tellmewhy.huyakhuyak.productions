import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, sharingGrants, therapistLinks, user } from "@/db/schema";
import { encryptText } from "./crypto/envelope";
import { getOrCreateUserDek } from "./crypto/user-keys";
import { NotFoundError, ValidationError } from "./errors";
import {
  acceptInvite,
  acknowledgeDeparture,
  createInvite,
  getActiveLinkForClient,
  getActiveLinksForTherapist,
  getPendingInviteForClient,
  listDepartures,
  revokeLink,
} from "./therapist-links";
import { cleanupSeededUsers, seedUser } from "@/test/seed-user";

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
  afterEach(cleanupSeededUsers);

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
    await expect(acceptInvite(token, therapistId)).rejects.toThrow(ValidationError);
  });

  it("keeps an expired invite in 'invited' status after rejection", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.update(therapistLinks).set({ createdAt: eightDaysAgo }).where(eq(therapistLinks.id, linkId));
    await expect(acceptInvite(token, therapistId)).rejects.toThrow(ValidationError);

    const [row] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(row.status).toBe("invited");
  });

  it("rejects a second use of the same token", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    const anotherUser = `test-${randomUUID()}`;
    await expect(acceptInvite(token, anotherUser)).rejects.toThrow(ValidationError);
  });

  it("rejects self-acceptance", async () => {
    const { token } = await createInvite(clientId, "client");
    await expect(acceptInvite(token, clientId)).rejects.toThrow(ValidationError);
  });

  it("rejects a second client-initiated invite while one is already pending", async () => {
    await createInvite(clientId, "client");
    await expect(createInvite(clientId, "client")).rejects.toThrow(ValidationError);
  });

  it("rejects a new client-initiated invite while the client already has an active link", async () => {
    const { token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);
    await expect(createInvite(clientId, "client")).rejects.toThrow(ValidationError);
  });

  it("rejects accepting a therapist-initiated invite when the client already has an active link (one-active-link rule at accept)", async () => {
    const firstTherapist = `test-${randomUUID()}`;
    const { token: firstToken } = await createInvite(clientId, "client");
    await acceptInvite(firstToken, firstTherapist);

    const secondTherapist = `test-${randomUUID()}`;
    const { linkId: secondLinkId, token: secondToken } = await createInvite(secondTherapist, "therapist");
    await expect(acceptInvite(secondToken, clientId)).rejects.toThrow(ValidationError);

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
    await seedUser(clientId);
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

  it("is single-shot: a second revoke throws NotFoundError, writes no duplicate audit row, and leaves revokedAt unchanged", async () => {
    const { linkId, token } = await createInvite(clientId, "client");
    await acceptInvite(token, therapistId);

    await revokeLink(linkId, clientId);
    const [firstRow] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(firstRow.status).toBe("revoked");
    const originalRevokedAt = firstRow.revokedAt;
    expect(originalRevokedAt).not.toBeNull();

    await expect(revokeLink(linkId, clientId)).rejects.toThrow(NotFoundError);
    // A different party attempting the second revoke hits the same idempotence
    // guard — not a permission error, since there's simply nothing left for
    // anyone to revoke.
    await expect(revokeLink(linkId, therapistId)).rejects.toThrow(NotFoundError);

    const [secondRow] = await db.select().from(therapistLinks).where(eq(therapistLinks.id, linkId));
    expect(secondRow.revokedAt?.getTime()).toBe(originalRevokedAt?.getTime());

    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "link_revoked")));
    expect(events).toHaveLength(1);
  });

  // Regression coverage for the misattribution the actor column fixes: a
  // therapist-initiated revoke or invite must never render as the client's
  // own action in their feed, and a pre-migration row with no recorded actor
  // must stay neutral rather than guess.
  describe("audit rows carry their real actor", () => {
    it("stamps link_revoked with the actor who actually revoked it, whichever side", async () => {
      const { linkId: clientRevokeLinkId, token: token1 } = await createInvite(clientId, "client");
      await acceptInvite(token1, therapistId);
      await revokeLink(clientRevokeLinkId, clientId);
      const [byClient] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "link_revoked")));
      expect(byClient.actorId).toBe(clientId);

      const secondClientId = `test-${randomUUID()}`;
      const secondTherapistId = `test-${randomUUID()}`;
      const { linkId: therapistRevokeLinkId, token: token2 } = await createInvite(secondClientId, "client");
      await acceptInvite(token2, secondTherapistId);
      await revokeLink(therapistRevokeLinkId, secondTherapistId);
      const [byTherapist] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, secondClientId), eq(auditEvents.action, "link_revoked")));
      expect(byTherapist.actorId).toBe(secondTherapistId);
    });

    it("renders therapist-attributed copy in the client feed when the THERAPIST revoked, and client copy unchanged when the client did", async () => {
      const { describeAuditAction, resolveAuditActor } = await import("./audit-copy");
      const therapistUser = await insertUser({ name: "Dr. Okafor" });
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistUser);
      await revokeLink(linkId, therapistUser);

      const [event] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "link_revoked")));
      const actor = resolveAuditActor(event.action, event.actorId, clientId, event.therapistId);
      expect(actor).toBe("therapist");
      expect(describeAuditAction(event.action, "Dr. Okafor", actor)).toBe("Dr. Okafor ended your connection");

      const secondClientId = `test-${randomUUID()}`;
      const { linkId: linkId2, token: token2 } = await createInvite(secondClientId, "client");
      await acceptInvite(token2, therapistId);
      await revokeLink(linkId2, secondClientId);
      const [event2] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, secondClientId), eq(auditEvents.action, "link_revoked")));
      const actor2 = resolveAuditActor(event2.action, event2.actorId, secondClientId, event2.therapistId);
      expect(actor2).toBe("client");
      expect(describeAuditAction(event2.action, "Dr. Okafor", actor2)).toBe("You ended your connection");
    });

    it("falls back to a neutral 'Your connection ended' for a legacy row with no recorded actor", async () => {
      const { describeAuditAction, resolveAuditActor } = await import("./audit-copy");
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);
      await revokeLink(linkId, clientId);

      const [event] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.clientId, clientId), eq(auditEvents.action, "link_revoked")));
      // Simulate a row written before the actor_id column existed.
      await db.update(auditEvents).set({ actorId: null }).where(eq(auditEvents.id, event.id));
      const [legacyEvent] = await db.select().from(auditEvents).where(eq(auditEvents.id, event.id));

      const actor = resolveAuditActor(legacyEvent.action, legacyEvent.actorId, clientId, legacyEvent.therapistId);
      expect(actor).toBe("unknown");
      expect(describeAuditAction(legacyEvent.action, "Dr. Whoever", actor)).toBe("Your connection ended");
    });
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

  it("surfaces a client's own still-pending invite, then stops once accepted", async () => {
    expect(await getPendingInviteForClient(clientId)).toBeNull();

    const { linkId, token } = await createInvite(clientId, "client");
    expect(await getPendingInviteForClient(clientId)).toEqual({ linkId });

    await acceptInvite(token, therapistId);
    // Now active, not invited — the pending lookup must go quiet.
    expect(await getPendingInviteForClient(clientId)).toBeNull();
  });

  describe("departures", () => {
    it("lists an unacknowledged departure with the name only the survivor can read", async () => {
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);

      // Seed: active link, then simulate departure the way deleteAccount does:
      const therapistDek = await getOrCreateUserDek(therapistId);
      await db.update(therapistLinks).set({
        status: "revoked", revokedAt: new Date(), departedAt: new Date(),
        departedNameCiphertext: encryptText(therapistDek, "Departed Client"),
      }).where(eq(therapistLinks.id, linkId));

      const departures = await listDepartures(therapistId);
      expect(departures).toHaveLength(1);
      expect(departures[0]).toMatchObject({ linkId, name: "Departed Client" });

      // The other party of some other link — or anyone else — sees nothing.
      expect(await listDepartures(`test-${randomUUID()}`)).toHaveLength(0);
    });

    it("falls back to a null name on a corrupt snapshot instead of failing the list", async () => {
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);

      await db.update(therapistLinks).set({
        status: "revoked", departedAt: new Date(), departedNameCiphertext: "v1.not.real.ciphertext",
      }).where(eq(therapistLinks.id, linkId));
      const departures = await listDepartures(therapistId);
      expect(departures).toHaveLength(1);
      expect(departures[0].name).toBeNull();
    });

    it("attributes each departure to the side that actually left for a dual-role user", async () => {
      // One user who is both a client (of a departed therapist) and a therapist
      // (of a departed client) — party to two departures from opposite sides.
      const dualRoleId = `test-${randomUUID()}`;
      const departedTherapistId = `test-${randomUUID()}`;
      const departedClientId = `test-${randomUUID()}`;

      // Link where the dual-role user is the CLIENT; their therapist departs.
      const { linkId: clientSideLinkId, token: clientSideToken } = await createInvite(dualRoleId, "client");
      await acceptInvite(clientSideToken, departedTherapistId);

      // Link where the dual-role user is the THERAPIST; their client departs.
      const { linkId: therapistSideLinkId, token: therapistSideToken } = await createInvite(dualRoleId, "therapist");
      await acceptInvite(therapistSideToken, departedClientId);

      const dek = await getOrCreateUserDek(dualRoleId);
      await db.update(therapistLinks).set({
        status: "revoked", revokedAt: new Date(), departedAt: new Date(),
        departedNameCiphertext: encryptText(dek, "Departed Therapist"),
      }).where(eq(therapistLinks.id, clientSideLinkId));
      await db.update(therapistLinks).set({
        status: "revoked", revokedAt: new Date(), departedAt: new Date(),
        departedNameCiphertext: encryptText(dek, "Departed Client"),
      }).where(eq(therapistLinks.id, therapistSideLinkId));

      const departures = await listDepartures(dualRoleId);
      const byLink = new Map(departures.map((d) => [d.linkId, d]));
      // Caller was the client ⇒ the therapist side left; caller was the therapist
      // ⇒ the client side left.
      expect(byLink.get(clientSideLinkId)?.departedSide).toBe("therapist");
      expect(byLink.get(therapistSideLinkId)?.departedSide).toBe("client");
    });

    it("acknowledging removes it from the list; repeats and strangers 404", async () => {
      const { linkId, token } = await createInvite(clientId, "client");
      await acceptInvite(token, therapistId);

      await db.update(therapistLinks).set({
        status: "revoked", departedAt: new Date(),
      }).where(eq(therapistLinks.id, linkId));

      await expect(acknowledgeDeparture(linkId, `test-${randomUUID()}`)).rejects.toBeInstanceOf(NotFoundError);
      await acknowledgeDeparture(linkId, therapistId);
      expect(await listDepartures(therapistId)).toHaveLength(0);
      await expect(acknowledgeDeparture(linkId, therapistId)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
