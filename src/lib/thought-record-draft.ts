// The client-side shape of a CBT thought record while it's being worked on — a
// worksheet draft. Kept deliberately free of any server/DB import so it can be
// shared by the worksheet form, the chat "save what we worked out" hand-off,
// and their unit tests. The canonical persisted schema lives in
// `@/lib/exercises` (thoughtRecordSchema); this module only mirrors its field
// set and bounds so a draft can never balloon past what the API will accept.

// The one sessionStorage key the chat extraction path stashes a prefilled draft
// under before routing to /exercises. Never a URL param — a thought record is
// the person's private content and must not land in history or logs.
export const THOUGHT_RECORD_DRAFT_KEY = "tellmewhy:thought-record-draft";

// Every field is a plain string in the draft (a blank optional field is "",
// never undefined) so the controlled form has a stable, defined value for each.
export type ThoughtRecordDraft = {
  occurredAt: string;
  situation: string;
  thoughts: string;
  emotions: string;
  behavior: string;
  bodySensations: string;
};

// The bounds mirror thoughtRecordSchema in @/lib/exercises. occurredAt is a
// short free-text "when" (not a date), so it carries the tighter cap.
const MAX_TEXT = 2000;
const MAX_OCCURRED_AT = 100;

export const EMPTY_DRAFT: ThoughtRecordDraft = {
  occurredAt: "",
  situation: "",
  thoughts: "",
  emotions: "",
  behavior: "",
  bodySensations: "",
};

// The four columns of the classic thought record that carry the reflection —
// each must hold at least a few words before the record can be saved. The two
// optional fields (occurredAt, bodySensations) are context the person may skip.
export const REQUIRED_FIELDS = ["situation", "thoughts", "emotions", "behavior"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

// The API-facing payload — optional fields are omitted entirely when blank so
// the record stays lean and the server schema's optionals stay truly optional.
export type ThoughtRecordPayload = {
  situation: string;
  thoughts: string;
  emotions: string;
  behavior: string;
  bodySensations?: string;
  occurredAt?: string;
};

function clampedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

// Read a draft the chat extraction path stashed. Deliberately forgiving: a
// partial extraction (only some fields filled) still prefills, and any
// non-string / over-length / malformed value is coerced away rather than
// trusted — sessionStorage is client-writable, so this never assumes a
// well-formed payload. Returns null when there's nothing usable to prefill (bad
// JSON, not an object, or every field blank), so the form opens empty instead
// of pretending a hand-off happened.
export function parseDraft(raw: string | null | undefined): ThoughtRecordDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  const draft: ThoughtRecordDraft = {
    occurredAt: clampedString(record.occurredAt, MAX_OCCURRED_AT),
    situation: clampedString(record.situation, MAX_TEXT),
    thoughts: clampedString(record.thoughts, MAX_TEXT),
    emotions: clampedString(record.emotions, MAX_TEXT),
    behavior: clampedString(record.behavior, MAX_TEXT),
    bodySensations: clampedString(record.bodySensations, MAX_TEXT),
  };

  const hasContent = Object.values(draft).some((value) => value.trim().length > 0);
  return hasContent ? draft : null;
}

// Serialize a draft (or a raw extraction payload) for the sessionStorage
// hand-off: only non-blank, trimmed fields are kept, so an empty draft
// serializes to "{}" and never masquerades as a real hand-off on the next read.
export function serializeDraft(draft: Partial<ThoughtRecordDraft>): string {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (typeof value === "string" && value.trim().length > 0) out[key] = value.trim();
  }
  return JSON.stringify(out);
}

// Which required columns are still blank — drives the form's gentle "add a few
// words here" prompt and decides whether a save may proceed. Whitespace-only
// counts as blank: the server schema is min(1) with no trim of its own, but
// draftToPayload trims before sending, so a spaces-only field would arrive
// empty and be rejected — this check catches it before the round trip.
export function missingRequiredFields(draft: Pick<ThoughtRecordDraft, RequiredField>): RequiredField[] {
  return REQUIRED_FIELDS.filter((field) => draft[field].trim().length === 0);
}

// Build the POST /api/entries payload from a draft: every field trimmed,
// optionals dropped when blank. Assumes required fields are present (the caller
// checks missingRequiredFields first); the server re-validates regardless.
export function draftToPayload(draft: ThoughtRecordDraft): ThoughtRecordPayload {
  const payload: ThoughtRecordPayload = {
    situation: draft.situation.trim(),
    thoughts: draft.thoughts.trim(),
    emotions: draft.emotions.trim(),
    behavior: draft.behavior.trim(),
  };
  const bodySensations = draft.bodySensations.trim();
  if (bodySensations) payload.bodySensations = bodySensations;
  const occurredAt = draft.occurredAt.trim();
  if (occurredAt) payload.occurredAt = occurredAt;
  return payload;
}
