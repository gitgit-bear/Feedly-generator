import { googleNewsToken, isGoogleNewsUrl, unwrapGoogleNewsUrlLocal } from "./googleNews";
import { isToday } from "./rank";
import type { ReportItem, ReportPayload } from "./reportPayload";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function fetchSignature(token: string, timeoutMs: number): Promise<{ sg: string; ts: string } | null> {
  const urls = [`https://news.google.com/rss/articles/${token}`, `https://news.google.com/articles/${token}`];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
        cache: "no-store",
      });
      if (!res.ok) continue;
      const html = await res.text();
      const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
      const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
      if (sg && ts) return { sg, ts };
    } catch {
      /* try the other article URL */
    }
  }
  return null;
}

function parseBatchexecute(text: string): string | null {
  const trimmed = text.replace(/^\)\]\}'\s*/, "").trim();
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) return null;
  const inner = parsed[0][2];
  if (typeof inner !== "string") return null;
  const decoded = JSON.parse(inner) as unknown;
  if (!Array.isArray(decoded)) return null;
  const url = decoded.find((part) => typeof part === "string" && /^https?:\/\//i.test(part));
  return typeof url === "string" && !isGoogleNewsUrl(url) ? url : null;
}

async function decodeViaBatch(token: string, sg: string, ts: string, timeoutMs: number): Promise<string | null> {
  const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${token}",${ts},"${sg}"]`;
  const body = new URLSearchParams({
    "f.req": JSON.stringify([[["Fbv4je", inner]]]),
  });
  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return parseBatchexecute(await res.text());
}

export async function unwrapGoogleNewsUrl(url: string, timeoutMs = 3500): Promise<string> {
  if (!isGoogleNewsUrl(url)) return url;
  const local = unwrapGoogleNewsUrlLocal(url);
  if (local) return local;
  const token = googleNewsToken(url);
  if (!token) return url;
  const started = Date.now();
  const sig = await fetchSignature(token, Math.max(800, timeoutMs - 1200));
  if (!sig) return url;
  const remain = timeoutMs - (Date.now() - started);
  if (remain < 400) return url;
  try {
    return (await decodeViaBatch(token, sig.sg, sig.ts, remain)) ?? url;
  } catch {
    return url;
  }
}

export async function unwrapArticleList<T extends { url: string; pubDate?: string | null; fetchedAt?: string }>(
  items: T[],
  budgetMs = 5000,
): Promise<T[]> {
  const local = items.map((item) => {
    const url = unwrapGoogleNewsUrlLocal(item.url);
    return url && url !== item.url ? { ...item, url } : item;
  });
  const pending = local
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isGoogleNewsUrl(item.url))
    .sort((a, b) => {
      const aToday = isToday(a.item.pubDate || a.item.fetchedAt || null) ? 0 : 1;
      const bToday = isToday(b.item.pubDate || b.item.fetchedAt || null) ? 0 : 1;
      return aToday - bToday;
    });
  if (!pending.length) return local;

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const { item } of pending) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item.url);
  }

  const deadline = Date.now() + budgetMs;
  const resolved = new Map<string, string>();
  let cursor = 0;
  const workerCount = Math.min(5, unique.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < unique.length) {
        if (Date.now() >= deadline) break;
        const url = unique[cursor];
        cursor += 1;
        const remain = deadline - Date.now();
        if (remain < 400) break;
        resolved.set(url, await unwrapGoogleNewsUrl(url, Math.min(3500, remain)));
      }
    }),
  );

  return local.map((item) => {
    const next = resolved.get(item.url);
    return next && next !== item.url ? { ...item, url: next } : item;
  });
}

export async function unwrapReportPayload(payload: ReportPayload): Promise<ReportPayload> {
  const slots = payload.topItems
    .map((item, index) => ({ item, index }))
    .filter((slot): slot is { item: ReportItem; index: number } => !!slot.item && isGoogleNewsUrl(slot.item.url));
  if (!slots.length) return payload;
  const unwrapped = await unwrapArticleList(
    slots.map(({ item }) => item),
    8000,
  );
  const topItems = [...payload.topItems];
  slots.forEach((slot, i) => {
    topItems[slot.index] = unwrapped[i];
  });
  return { ...payload, topItems };
}
