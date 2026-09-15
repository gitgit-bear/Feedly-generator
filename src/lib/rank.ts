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
];

const BOOST = ["zero-day", "zero day", "0-day", "actively exploited", "ransomware", "data breach", "cve-"];

const EVENT_RE =
  /(?:\[\s*virtual\s+event\s*\]|\bwebinars?\b|\bwebcasts?\b|\bweb[- ]?seminars?\b|\bonline\s+events?\b|\bvirtual\s+events?\b|\bregister\s+now\b)/i;
const EVENT_URL_RE = /\/(?:events?|webinars?|webcasts?)(?:\/|$|\?)/i;

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

export function top10(articles: Article[]): Article[] {
  return articles
    .filter((a) => !isEventOrWebinar(a) && isToday(a.pubDate || a.fetchedAt))
    .sort((a, b) => {
      const rb = relevanceScore(b) - relevanceScore(a);
      if (Math.abs(rb) > 0.0001) return rb;
      return (b.pubDate || b.fetchedAt).localeCompare(a.pubDate || a.fetchedAt);
    })
    .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id || x.title === a.title) === i)
    .slice(0, 10);
}
