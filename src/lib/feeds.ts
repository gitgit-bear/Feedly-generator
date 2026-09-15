import Parser from "rss-parser";
import { FALLBACKS } from "./sources";
import type { Article, FeedSource } from "./types";

const parser = new Parser({
  timeout: 8000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 CyberGuardWeb/1.0",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  },
});

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      const low = key.toLowerCase();
      if (low.startsWith("utm_") || ["fbclid", "gclid", "ref", "source"].includes(low)) {
        u.searchParams.delete(key);
      }
    }
    return u.toString();
  } catch {
    return url.trim();
  }
}

function articleId(url: string, title: string, source: string): string {
  const norm = normalizeUrl(url) || `${source}:${title}`;
  return Buffer.from(norm).toString("base64url").slice(0, 80);
}

async function parseFeed(url: string): Promise<Parser.Output<Parser.Item>> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 CyberGuardWeb/1.0",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      "Accept-Encoding": "gzip, deflate",
    },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parser.parseString(xml);
}

export async function fetchSource(
  source: FeedSource,
): Promise<{ articles: Article[]; error?: string }> {
  const urls = [source.url, ...(FALLBACKS[source.id] ?? [])];
  let lastErr = "Fetch failed";
  for (const url of urls) {
    try {
      const parsed = await parseFeed(url);
      const now = new Date().toISOString();
      const articles: Article[] = (parsed.items ?? []).slice(0, 8).flatMap((item) => {
        const link = (item.link || item.guid || "").trim();
        if (!link) return [];
        const title = (item.title || "Untitled").replace(/<[^>]+>/g, "").trim();
        return [
          {
            id: articleId(link, title, source.name),
            title,
            description: (item.contentSnippet || item.content || "").replace(/<[^>]+>/g, "").slice(0, 400),
            url: link,
            source: source.name,
            sourceId: source.id,
            pubDate: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
            fetchedAt: now,
            read: false,
          },
        ];
      });
      if (articles.length) return { articles };
      lastErr = "No entries in feed";
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  return { articles: [], error: lastErr };
}
