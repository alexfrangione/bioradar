import type { MetadataRoute } from "next";

// Generated to https://bioticker.us/robots.txt at build time. Allow all
// crawlers everywhere; point them at the sitemap so they discover the full
// company universe without needing to follow links.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://bioticker.us/sitemap.xml",
    host: "https://bioticker.us",
  };
}
