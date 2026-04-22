import type { MetadataRoute } from "next";
import { POPULAR_TICKERS } from "@/lib/universe";

// Generated to https://bioticker.us/sitemap.xml at build time. Lists the
// static marketing/app pages and one entry per ticker in the popular
// healthcare universe so Googlebot & friends can surface deep-linked
// company pages (e.g. /company/MRNA) directly from search.
const BASE = "https://bioticker.us";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE}/catalysts`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/heatmap`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/screener`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/pipeline`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/watchlist`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
  ];

  const tickerPages: MetadataRoute.Sitemap = POPULAR_TICKERS.map((ticker) => ({
    url: `${BASE}/company/${ticker}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.6,
  }));

  return [...staticPages, ...tickerPages];
}
