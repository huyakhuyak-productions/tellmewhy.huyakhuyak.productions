// Sanitize a post-auth redirect target ("?next=…"). Only a root-relative path
// on this same origin may ever be followed — a freshly signed-in person must
// never be bounced to another site by a crafted link. Everything else
// (protocol-relative "//evil.com", backslash tricks "/\\evil.com", absolute
// URLs, non-paths) collapses to null so the caller falls back to its own
// default destination.
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!raw.startsWith("/")) return null;
  // "//host" is protocol-relative; "/\host" is the backslash variant browsers
  // normalize to "//host". Both leave this origin — reject them.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}
