// Shared domain error: both conversations.ts and folders.ts throw it for a
// row that doesn't exist or isn't owned by the caller, and every API route
// catches it to answer with 404 instead of a 500.
export class NotFoundError extends Error {}

// A domain input-validation failure whose message is a static, client-safe
// string. Routes catch it to answer 400 and may echo its message verbatim —
// which is exactly why ONLY validation paths may throw it: an infrastructure
// error (DB, crypto) must stay a plain Error so it rethrows into a 500
// instead of leaking its internals into a response body.
export class ValidationError extends Error {}

// The one shape a failure log may carry about an error: name + message,
// never the object itself — AI/crypto/JSON errors can embed decrypted
// content in their properties, and a raw dump would put plaintext in logs.
export function errorCause(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}
