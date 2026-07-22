import { KeyShreddedError } from "@/lib/crypto/user-keys";

// Shared domain error: both conversations.ts and folders.ts throw it for a
// row that doesn't exist or isn't owned by the caller, and every API route
// catches it to answer with 404 instead of a 500.
export class NotFoundError extends Error {
  // Without this, the class inherits Error's default .name, so errorCause
  // below (and every failure log through it) would mislabel it as "Error".
  override readonly name = "NotFoundError";
}

// A domain input-validation failure whose message is a static, client-safe
// string. Routes catch it to answer 400 and may echo its message verbatim —
// which is exactly why ONLY validation paths may throw it: an infrastructure
// error (DB, crypto) must stay a plain Error so it rethrows into a 500
// instead of leaking its internals into a response body.
export class ValidationError extends Error {
  override readonly name = "ValidationError";
}

// The two domain errors that BOTH resolve to the app's uniform "Not found"
// 404: a genuinely absent-or-unowned row (NotFoundError) and a crypto-shredded
// user whose key vanished mid-race (KeyShreddedError, thrown when a just-deleted
// user's own stale session — or a therapist mid-race with a deleting client —
// asks for a tombstoned DEK). Every route catch and page loader tests
// membership through THIS predicate, so the indistinguishability posture (no
// oracle telling "shredded" apart from "never existed") lives in one place and
// a future uniform-404 error is added here alone, never drifting across ~30
// catch blocks.
export function isUniformNotFound(error: unknown): boolean {
  return error instanceof NotFoundError || error instanceof KeyShreddedError;
}

// The one shape a failure log may carry about an error: name + message,
// never the object itself — AI/crypto/JSON errors can embed decrypted
// content in their properties, and a raw dump would put plaintext in logs.
export function errorCause(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}
