import { describe, expect, it } from "vitest";
import { describeAuditAction, isClientAction } from "./audit-copy";

describe("describeAuditAction", () => {
  it("names the therapist for their own actions when the name is known", () => {
    expect(describeAuditAction("conversation_viewed", "Marta")).toBe("Marta read a shared conversation");
    expect(describeAuditAction("review_marker_advanced", "Marta")).toBe("Marta marked how far they'd read");
    expect(describeAuditAction("intervention_sent", "Marta")).toBe("Marta wrote to you");
    expect(describeAuditAction("note_published", "Marta")).toBe("Marta left you a note");
    expect(describeAuditAction("link_accepted", "Marta")).toBe("Marta is now your trusted person");
  });

  it("falls back to 'Your trusted person' when the name is unknown", () => {
    expect(describeAuditAction("conversation_viewed", null)).toBe("Your trusted person read a shared conversation");
    expect(describeAuditAction("link_accepted", null)).toBe("Your trusted person joined");
  });

  it("phrases the client's own actions in the first person", () => {
    expect(describeAuditAction("link_invited", null)).toBe("You invited a trusted person");
    expect(describeAuditAction("grant_created", "Marta")).toBe("You started sharing a conversation");
    expect(describeAuditAction("grant_revoked", "Marta")).toBe("You stopped sharing a conversation");
    expect(describeAuditAction("link_revoked", "Marta")).toBe("You ended your connection with Marta");
    expect(describeAuditAction("link_revoked", null)).toBe("You ended your connection");
  });
});

describe("isClientAction", () => {
  it("marks the client's own actions", () => {
    expect(isClientAction("link_invited")).toBe(true);
    expect(isClientAction("grant_created")).toBe(true);
    expect(isClientAction("grant_revoked")).toBe(true);
    expect(isClientAction("link_revoked")).toBe(true);
  });

  it("marks therapist actions as not the client's", () => {
    expect(isClientAction("conversation_viewed")).toBe(false);
    expect(isClientAction("review_marker_advanced")).toBe(false);
    expect(isClientAction("intervention_sent")).toBe(false);
    expect(isClientAction("note_published")).toBe(false);
    expect(isClientAction("link_accepted")).toBe(false);
  });
});
