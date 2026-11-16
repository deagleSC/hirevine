import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return ["", "/?for=jobseekers", "/responsible-ai", "/about", "/privacy", "/terms"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: p ? "monthly" : "weekly",
    priority: p ? 0.7 : 1,
  }));
}
