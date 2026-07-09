import { describe, expect, it } from "vitest";
import { describeAuditAction, isClientAction, resolveAuditActor } from "./audit-copy";

describe("describeAuditAction", () => {
  it("names the therapist for their own actions when the name is known", () => {
    expect(describeAuditAction("conversation_viewed", "Marta", "therapist")).toBe("Marta read a shared conversation");
    expect(describeAuditAction("review_marker_advanced", "Marta", "therapist")).toBe("Marta marked how far they'd read");
    expect(describeAuditAction("intervention_sent", "Marta", "therapist")).toBe("Marta wrote to you");
    expect(describeAuditAction("note_published", "Marta", "therapist")).toBe("Marta left you a note");
    expect(describeAuditAction("attention_viewed", "Marta", "therapist")).toBe(
      "Marta checked on your flagged and crisis messages",
    );
    expect(describeAuditAction("link_accepted", "Marta", "therapist")).toBe("Marta is now your trusted person");
  });

  it("falls back to 'Your trusted person' when the name is unknown", () => {
    expect(describeAuditAction("conversation_viewed", null, "therapist")).toBe("Your trusted person read a shared conversation");
    expect(describeAuditAction("attention_viewed", null, "therapist")).toBe(
      "Your trusted person checked on your flagged and crisis messages",
    );
    expect(describeAuditAction("link_accepted", null, "therapist")).toBe("Your trusted person joined");
  });

  it("phrases the client's own actions in the first person", () => {
    expect(describeAuditAction("link_invited", null, "client")).toBe("You invited a trusted person");
    expect(describeAuditAction("grant_created", "Marta", "client")).toBe("You started sharing a conversation");
    expect(describeAuditAction("grant_revoked", "Marta", "client")).toBe("You stopped sharing a conversation");
    expect(describeAuditAction("link_revoked", "Marta", "client")).toBe("You ended your connection");
  });

  it("attributes link_invited and link_revoked to whichever party actually acted", () => {
    // A therapist-initiated invite must never read as the client's own doing.
    expect(describeAuditAction("link_invited", "Marta", "therapist")).toBe("Marta invited you");
    expect(describeAuditAction("link_invited", null, "therapist")).toBe("Your trusted person invited you");
    // A therapist-initiated revoke must never read as "You ended...".
    expect(describeAuditAction("link_revoked", "Marta", "therapist")).toBe("Marta ended your connection");
    expect(describeAuditAction("link_revoked", null, "therapist")).toBe("Your trusted person ended your connection");
  });

  it("stays neutral for a legacy link_revoked row with no recorded actor", () => {
    expect(describeAuditAction("link_revoked", "Marta", "unknown")).toBe("Your connection ended");
    expect(describeAuditAction("link_revoked", null, "unknown")).toBe("Your connection ended");
  });
});

describe("resolveAuditActor", () => {
  const clientId = "client-1";
  const therapistId = "therapist-1";

  it("fixes grant actions to the client and read/write actions to the therapist", () => {
    expect(resolveAuditActor("grant_created", null, clientId, therapistId)).toBe("client");
    expect(resolveAuditActor("grant_revoked", null, clientId, therapistId)).toBe("client");
    expect(resolveAuditActor("conversation_viewed", null, clientId, therapistId)).toBe("therapist");
    expect(resolveAuditActor("review_marker_advanced", null, clientId, therapistId)).toBe("therapist");
    expect(resolveAuditActor("intervention_sent", null, clientId, therapistId)).toBe("therapist");
    expect(resolveAuditActor("note_published", null, clientId, therapistId)).toBe("therapist");
    expect(resolveAuditActor("attention_viewed", null, clientId, therapistId)).toBe("therapist");
    expect(resolveAuditActor("link_accepted", null, clientId, therapistId)).toBe("therapist");
  });

  it("resolves link_invited/link_revoked from actorId when present", () => {
    expect(resolveAuditActor("link_invited", clientId, clientId, therapistId)).toBe("client");
    expect(resolveAuditActor("link_invited", therapistId, clientId, therapistId)).toBe("therapist");
    expect(resolveAuditActor("link_revoked", clientId, clientId, therapistId)).toBe("client");
    expect(resolveAuditActor("link_revoked", therapistId, clientId, therapistId)).toBe("therapist");
  });

  it("falls back to the therapistId-null invariant for a legacy link_invited row", () => {
    // createInvite only ever writes link_invited with therapistId null when
    // client-initiated; acceptInvite's deferred write always has it set.
    expect(resolveAuditActor("link_invited", null, clientId, null)).toBe("client");
    expect(resolveAuditActor("link_invited", null, clientId, therapistId)).toBe("therapist");
  });

  it("has no reliable signal for a legacy link_revoked row — resolves unknown", () => {
    expect(resolveAuditActor("link_revoked", null, clientId, therapistId)).toBe("unknown");
  });
});

describe("isClientAction", () => {
  it("marks the client actor as the client's own action", () => {
    expect(isClientAction("client")).toBe(true);
  });

  it("marks the therapist actor as not the client's", () => {
    expect(isClientAction("therapist")).toBe(false);
  });

  it("treats an unknown (legacy) actor as quiet/neutral, not the therapist's", () => {
    expect(isClientAction("unknown")).toBe(true);
  });
});
