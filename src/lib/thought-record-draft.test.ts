import { describe, expect, it } from "vitest";
import {
  draftToPayload,
  EMPTY_DRAFT,
  missingRequiredFields,
  parseDraft,
  serializeDraft,
  THOUGHT_RECORD_DRAFT_KEY,
  type ThoughtRecordDraft,
} from "./thought-record-draft";

const FULL: ThoughtRecordDraft = {
  occurredAt: "last night",
  situation: "A message I didn't reply to",
  thoughts: "They think I'm rude",
  emotions: "anxiety, shame",
  behavior: "kept refreshing the chat",
  bodySensations: "tight chest",
};

describe("parseDraft", () => {
  it("returns null for null, empty, or non-JSON input", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft(undefined)).toBeNull();
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("not json {")).toBeNull();
  });

  it("returns null for JSON that isn't a usable object", () => {
    expect(parseDraft("42")).toBeNull();
    expect(parseDraft('"a string"')).toBeNull();
    expect(parseDraft("null")).toBeNull();
    // An array has no thought-record keys, so every field recovers blank → null.
    expect(parseDraft("[1,2,3]")).toBeNull();
  });

  it("returns null when every recovered field is blank", () => {
    expect(parseDraft("{}")).toBeNull();
    expect(parseDraft(JSON.stringify({ situation: "   " }))).toBeNull();
    expect(parseDraft(JSON.stringify({ unrelated: "value" }))).toBeNull();
  });

  it("recovers a full draft, filling absent fields with empty strings", () => {
    const draft = parseDraft(JSON.stringify({ situation: "at work", thoughts: "I failed" }));
    expect(draft).toEqual({
      occurredAt: "",
      situation: "at work",
      thoughts: "I failed",
      emotions: "",
      behavior: "",
      bodySensations: "",
    });
  });

  it("coerces non-string fields away instead of trusting them", () => {
    const draft = parseDraft(
      JSON.stringify({ situation: "real", thoughts: 123, emotions: { nested: true }, behavior: null }),
    );
    expect(draft).toEqual({
      occurredAt: "",
      situation: "real",
      thoughts: "",
      emotions: "",
      behavior: "",
      bodySensations: "",
    });
  });

  it("clamps over-long fields to their bounds", () => {
    const long = "x".repeat(5000);
    const draft = parseDraft(JSON.stringify({ situation: long, occurredAt: long }));
    expect(draft!.situation).toHaveLength(2000);
    expect(draft!.occurredAt).toHaveLength(100);
  });

  it("ignores unknown keys", () => {
    const draft = parseDraft(JSON.stringify({ situation: "keep", secret: "drop" }));
    expect(draft).not.toHaveProperty("secret");
    expect(draft!.situation).toBe("keep");
  });
});

describe("serializeDraft", () => {
  it("keeps only non-blank fields, trimmed", () => {
    const json = serializeDraft({ situation: "  padded  ", thoughts: "", emotions: "   " });
    expect(JSON.parse(json)).toEqual({ situation: "padded" });
  });

  it("serializes an empty draft to an empty object that parses back to null", () => {
    const json = serializeDraft(EMPTY_DRAFT);
    expect(json).toBe("{}");
    expect(parseDraft(json)).toBeNull();
  });

  it("round-trips a full draft through parse", () => {
    const roundTripped = parseDraft(serializeDraft(FULL));
    expect(roundTripped).toEqual(FULL);
  });
});

describe("missingRequiredFields", () => {
  it("reports all four required columns when blank", () => {
    expect(missingRequiredFields(EMPTY_DRAFT)).toEqual([
      "situation",
      "thoughts",
      "emotions",
      "behavior",
    ]);
  });

  it("treats whitespace-only as blank", () => {
    expect(missingRequiredFields({ ...EMPTY_DRAFT, situation: "   ", thoughts: "real", emotions: "real", behavior: "real" })).toEqual([
      "situation",
    ]);
  });

  it("reports nothing when all required columns are filled", () => {
    expect(missingRequiredFields(FULL)).toEqual([]);
  });

  it("never reports optional fields", () => {
    const draft = { ...FULL, occurredAt: "", bodySensations: "" };
    expect(missingRequiredFields(draft)).toEqual([]);
  });
});

describe("draftToPayload", () => {
  it("trims every field and drops blank optionals", () => {
    const payload = draftToPayload({
      occurredAt: "   ",
      situation: "  sit  ",
      thoughts: " th ",
      emotions: " em ",
      behavior: " be ",
      bodySensations: "",
    });
    expect(payload).toEqual({ situation: "sit", thoughts: "th", emotions: "em", behavior: "be" });
    expect(payload).not.toHaveProperty("occurredAt");
    expect(payload).not.toHaveProperty("bodySensations");
  });

  it("includes optionals when present", () => {
    const payload = draftToPayload(FULL);
    expect(payload.occurredAt).toBe("last night");
    expect(payload.bodySensations).toBe("tight chest");
  });
});

describe("THOUGHT_RECORD_DRAFT_KEY", () => {
  it("uses the repo's tellmewhy: key convention", () => {
    expect(THOUGHT_RECORD_DRAFT_KEY.startsWith("tellmewhy:")).toBe(true);
  });
});
