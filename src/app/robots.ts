import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only the signed-out front door and the two auth pages are crawlable; every
// authenticated surface and the API are disallowed. This is the belt to the
// per-page `robots: { index: false }` suspenders — it keeps well-behaved
// crawlers from ever fetching a private route.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/sign-in", "/sign-up"],
      disallow: [
        "/chat",
        "/notes",
        "/exercises",
        "/trust",
        "/therapist",
        "/link",
        "/api",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
