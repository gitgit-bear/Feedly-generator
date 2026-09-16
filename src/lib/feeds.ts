import Parser from "rss-parser";
import { FALLBACKS } from "./sources";
import { isGoogleNewsLabel, readRssPublisher, stripPublisherSuffix, unwrapGoogleNewsUrlLocal } from "./googleNews";
import type { Article, FeedSource } from "./types";

const FETCH_MS = 3500;
const SOURCE_MS = 4000;

type RssItem = Parser.Item & { rssSource?: unknown };

const parser = new Parser<Record<string, unknown>, RssItem>({
  timeout: FETCH_MS,
  customFields: {
    item: [["source", "rssSource"]],
  },
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

async function parseFeed(url: string, timeoutMs: number): Promise<Parser.Output<RssItem>> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 CyberGuardWeb/1.0",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      "Accept-Encoding": "gzip, deflate",
    },
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate: 120 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parser.parseString(xml);
}

export async function fetchSource(
  source: FeedSource,
): Promise<{ articles: Article[]; error?: string }> {
  const urls = [source.url, ...(FALLBACKS[source.id] ?? [])];
  const deadline = Date.now() + SOURCE_MS;
  let lastErr = "Fetch failed";
  for (const url of urls) {
    const remain = deadline - Date.now();
    if (remain < 400) break;
    try {
      const parsed = await parseFeed(url, Math.min(FETCH_MS, remain));
      const now = new Date().toISOString();
      const articles: Article[] = (parsed.items ?? []).slice(0, 8).flatMap((item) => {
        const rawLink = (item.link || item.guid || "").trim();
        if (!rawLink) return [];
        const link = unwrapGoogleNewsUrlLocal(rawLink) || rawLink;
        let title = (item.title || "Untitled").replace(/<[^>]+>/g, "").trim();
        const publisher = readRssPublisher(item.rssSource, item.content || item.contentSnippet || "");
        const sourceName =
          source.id === "gnews" && publisher && !isGoogleNewsLabel(publisher) ? publisher : source.name;
        title = stripPublisherSuffix(title, publisher || (source.id === "gnews" ? sourceName : ""));
        return [
          {
            id: articleId(rawLink, title, sourceName),
            title,
            description: (item.contentSnippet || item.content || "").replace(/<[^>]+>/g, "").slice(0, 400),
            url: link,
            source: sourceName,
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
