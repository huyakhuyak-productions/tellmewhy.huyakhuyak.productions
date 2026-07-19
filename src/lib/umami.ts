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

export const UMAMI_BEFORE_SEND_NAME = "__umamiBeforeSend";

// Inline bootstrap for Umami's data-before-send hook. Two URLs on this site
// carry live credentials — /reset-password?token=… and /link/<invite token> —
// and the app DB deliberately stores only token HASHES; analytics must not
// become a second store of raw tokens. data-exclude-search on the script tag
// strips query strings from the tracked page URL; this hook covers what that
// attribute can't reach: the /link/ path segment, and referrers (whose query
// string can smuggle an encoded token via ?next=). Rendered as a plain inline
// <script> ahead of the tracker so the handler exists before any send.
export const UMAMI_BEFORE_SEND_SNIPPET = `window.${UMAMI_BEFORE_SEND_NAME} = function (type, payload) {
  if (!payload) return payload;
  var scrub = function (value) {
    if (typeof value !== "string") return value;
    return value.split("?")[0].split("#")[0].replace(/\\/link\\/[^/?#]+/, "/link/redacted");
  };
  payload.url = scrub(payload.url);
  payload.referrer = scrub(payload.referrer);
  return payload;
};`;
