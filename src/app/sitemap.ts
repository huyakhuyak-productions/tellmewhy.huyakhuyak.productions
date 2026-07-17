import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Exactly the three public URLs — the front door and the two auth pages.
// Everything else is behind auth and deliberately absent from the sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: "monthly", priority: 1 },
    {
      url: `${SITE_URL}/sign-in`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/sign-up`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
