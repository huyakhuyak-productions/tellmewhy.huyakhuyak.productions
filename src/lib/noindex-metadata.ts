import type { Metadata } from "next";

// Authenticated surfaces must never be indexed. The App Router doesn't inherit a
// page's metadata into sibling routes, so each private page re-exports this as
// `export const metadata`. It's the per-page belt to the robots.txt suspenders.
export const noIndexMetadata: Metadata = {
  robots: { index: false, follow: false },
};
