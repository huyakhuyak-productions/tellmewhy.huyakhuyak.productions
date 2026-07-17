// Canonical origin for the public site — the single source of truth behind
// metadataBase, the robots/sitemap absolute URLs, JSON-LD `url` fields, and the
// llms.txt canonical link. Change it here and every SEO surface follows.
export const SITE_URL = "https://tellmewhy.huyakhuyak.productions";

// The one honest sentence the app leads with everywhere it introduces itself.
// Mirrors the landing hero: it says "encrypted the moment they're stored" (at
// rest) and never claims end-to-end encryption. The fuller privacy nuance lives
// in the FAQ and llms.txt.
export const SITE_DESCRIPTION =
  "A private place to talk about how you feel. An AI answers now, and one trusted person sees only what you choose to share. Your words are encrypted the moment they're stored.";
