import { isGoogleNewsUrl } from "./googleNews";
import { GOOGLE_SOURCE_IDS } from "./sources";
import type { Article } from "./types";

const TERMS = [
  "breach",
  "data breach",
  "ransomware",
  "zero-day",
  "zero day",
  "0-day",
  "cve-",
  "actively exploited",
  "in the wild",
  "critical vulnerability",
  "exploit",
  "malware",
  "apt",
  "nation-state",
  "state-sponsored",
  "phishing",
  "vulnerability",
  "patch tuesday",
  "supply chain",
  "supply-chain",
  "data leak",
  "botnet",
  "ddos",
  "lateral movement",
  "mfa bypass",
  "cyberattack",
  "cyber attack",
  "cyber-attack",
  "remote code execution",
  "authentication bypass",
  "infostealer",
  "info-stealer",
  "business email compromise",
  "emergency patch",
  "out-of-band",
];

const BOOST = [
  "zero-day",
  "zero day",
  "0-day",
  "actively exploited",
  "ransomware",
  "data breach",
  "cve-",
  "emergency patch",
  "out-of-band",
];

const EVENT_RE =
  /(?:\[\s*virtual\s+event\s*\]|\bwebinars?\b|\bwebcasts?\b|\bweb[- ]?seminars?\b|\bonline\s+events?\b|\bvirtual\s+events?\b|\bregister\s+now\b|\bstormcast\b|\bpodcasts?\b|podcastdetail)/i;
const EVENT_URL_RE = /\/(?:events?|webinars?|webcasts?|podcasts?|podcastdetail)(?:\/|$|\?)/i;

export function isEventOrWebinar(article: Pick<Article, "title" | "url">): boolean {
  return EVENT_RE.test(article.title) || EVENT_RE.test(article.url) || EVENT_URL_RE.test(article.url);
}

export function relevanceScore(article: Pick<Article, "title" | "description">): number {
  const blob = `${article.title} ${article.description}`.toLowerCase();
  const hits = TERMS.reduce((n, w) => n + (blob.includes(w) ? 1 : 0), 0);
  const extra = BOOST.reduce((n, p) => n + (blob.includes(p) ? 0.12 : 0), 0);
  return Math.min(1, hits * 0.052 + extra);
}

export function hkTodayStamp(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const midnightUtc =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (midnightUtc) {
    return iso.slice(0, 10) === hkTodayStamp();
  }
  return hkTodayStamp(d) === hkTodayStamp();
}

/** Report / TOP 10: use the date on the record (UTC calendar day), not HK overnight rollover. */
export function isReportToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return iso.slice(0, 10) === hkTodayStamp();
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "for",
  "to",
  "and",
  "or",
  "with",
  "after",
  "from",
  "by",
  "its",
  "as",
  "at",
  "is",
  "are",
  "be",
  "into",
  "over",
  "about",
  "that",
  "this",
]);

function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .map(stem)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  return inter / (left.size + right.size - inter);
}

export function sameStory(a: Pick<Article, "title" | "url" | "id">, b: Pick<Article, "title" | "url" | "id">): boolean {
  if (a.id === b.id || a.url === b.url) return true;
  if (urlKey(a.url) && urlKey(a.url) === urlKey(b.url)) return true;
  const ta = titleTokens(a.title);
  const tb = titleTokens(b.title);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  if (ta.slice(0, 5).join(" ") === tb.slice(0, 5).join(" ")) return true;
  const shared = ta.filter((token) => tb.includes(token) && token.length >= 5).length;
  const lead = ta[0] === tb[0] && ta[1] === tb[1];
  if (lead && shared >= 2 && jaccard(ta, tb) >= 0.28) return true;
  return jaccard(ta, tb) >= 0.62 && shared >= 3;
}

function preferArticle(a: Article, b: Article): Article {
  const aGoogle = isGoogleNewsUrl(a.url) ? 1 : 0;
  const bGoogle = isGoogleNewsUrl(b.url) ? 1 : 0;
  if (aGoogle !== bGoogle) return aGoogle < bGoogle ? a : b;
  const aSyndicated = GOOGLE_SOURCE_IDS.has(a.sourceId) ? 1 : 0;
  const bSyndicated = GOOGLE_SOURCE_IDS.has(b.sourceId) ? 1 : 0;
  if (aSyndicated !== bSyndicated) return aSyndicated < bSyndicated ? a : b;
  const rel = relevanceScore(a) - relevanceScore(b);
  if (Math.abs(rel) > 0.0001) return rel > 0 ? a : b;
  const aLen = a.description.length;
  const bLen = b.description.length;
  if (aLen !== bLen) return aLen > bLen ? a : b;
  return (a.pubDate || a.fetchedAt) >= (b.pubDate || b.fetchedAt) ? a : b;
}

export function dedupeStories(articles: Article[]): Article[] {
  const kept: Article[] = [];
  for (const article of articles) {
    const hit = kept.findIndex((item) => sameStory(item, article));
    if (hit < 0) {
      kept.push(article);
      continue;
    }
    const winner = preferArticle(article, kept[hit]);
    const loser = winner === article ? kept[hit] : article;
    kept[hit] = { ...winner, read: winner.read || loser.read };
  }
  return kept.sort((a, b) => (b.pubDate || b.fetchedAt).localeCompare(a.pubDate || a.fetchedAt));
}

const PER_SITE_LIMIT = 2;
const PER_SITE_FILL = 3;

function siteKey(article: Pick<Article, "url" | "source">): string {
  try {
    const host = new URL(article.url).hostname.replace(/^www\./i, "").toLowerCase();
    if (host && host !== "news.google.com") return host;
  } catch {
    /* fall through */
  }
  return article.source.trim().toLowerCase();
}

function pickWithSiteCap(ranked: Article[], cap: number, existing: Article[]): Article[] {
  const used = new Map<string, number>();
  const seen = new Set<string>();
  for (const article of existing) {
    const key = siteKey(article);
    used.set(key, (used.get(key) ?? 0) + 1);
    seen.add(article.id);
  }
  const picked = [...existing];
  for (const article of ranked) {
    if (picked.length >= 10) break;
    if (seen.has(article.id)) continue;
    const key = siteKey(article);
    const n = used.get(key) ?? 0;
    if (n >= cap) continue;
    used.set(key, n + 1);
    seen.add(article.id);
    picked.push(article);
  }
  return picked;
}

function articleTime(article: Pick<Article, "pubDate" | "fetchedAt">): string {
  return article.pubDate || article.fetchedAt || "";
}

function pickTop10Pool(ranked: Article[], existing: Article[]): Article[] {
  let picked = pickWithSiteCap(ranked, PER_SITE_LIMIT, existing);
  if (picked.length < 10) picked = pickWithSiteCap(ranked, PER_SITE_FILL, picked);
  return picked;
}

/** Prefer report-today stories; if fewer than 10, backfill by newest pub time (e.g. 22/9 23:59 → earlier). */
export function top10(articles: Article[]): Article[] {
  const eligible = dedupeStories(articles.filter((a) => !isEventOrWebinar(a) && Boolean(articleTime(a))));

  const todayRanked = eligible
    .filter((a) => isReportToday(a.pubDate))
    .sort((a, b) => {
      const rb = relevanceScore(b) - relevanceScore(a);
      if (Math.abs(rb) > 0.0001) return rb;
      return articleTime(b).localeCompare(articleTime(a));
    });

  let picked = pickTop10Pool(todayRanked, []);

  if (picked.length < 10) {
    const taken = new Set(picked.map((a) => a.id));
    const olderRanked = eligible
      .filter((a) => !taken.has(a.id) && !picked.some((p) => sameStory(p, a)))
      .sort((a, b) => articleTime(b).localeCompare(articleTime(a)));
    picked = pickTop10Pool(olderRanked, picked);
  }

  return picked.slice(0, 10);
}
