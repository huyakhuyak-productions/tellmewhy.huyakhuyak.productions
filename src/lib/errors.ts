// Shared domain error: both conversations.ts and folders.ts throw it for a
// row that doesn't exist or isn't owned by the caller, and every API route
// catches it to answer with 404 instead of a 500.
export class NotFoundError extends Error {}
