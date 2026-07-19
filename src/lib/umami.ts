// Self-hosted Umami analytics config. Both env vars must be present for the
// script to render at all — dev, test, and CI set neither, so they ship no
// analytics (the email-mock posture). Read at render time on the server; the
// Dockerfile's build stage declares matching ARGs so statically-prerendered
// pages bake the same values Dokku serves at runtime.
export type UmamiConfig = { src: string; websiteId: string };

export function getUmamiConfig(): UmamiConfig | null {
  const src = process.env.UMAMI_SCRIPT_URL;
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  if (!src || !websiteId) return null;
  return { src, websiteId };
}
