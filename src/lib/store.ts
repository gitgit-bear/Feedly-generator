import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Article, CacheState } from "./types";

function dataDir(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "cyberguard-web");
  }
  return path.join(process.cwd(), "data");
}

function cachePath(): string {
  return path.join(dataDir(), "cache.json");
}

const EMPTY: CacheState = {
  articles: [],
  agencies: { hkcert: [], govcert: [], cybersechub: [] },
  lastRefresh: null,
};

export async function loadCache(): Promise<CacheState> {
  try {
    const raw = await fs.readFile(cachePath(), "utf8");
    const parsed = JSON.parse(raw) as CacheState;
    return {
      articles: parsed.articles ?? [],
      agencies: parsed.agencies ?? EMPTY.agencies,
      lastRefresh: parsed.lastRefresh ?? null,
    };
  } catch {
    return { ...EMPTY, agencies: { hkcert: [], govcert: [], cybersechub: [] } };
  }
}

export async function saveCache(state: CacheState): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(cachePath(), JSON.stringify(state, null, 2), "utf8");
}

export async function mergeArticles(incoming: Article[]): Promise<CacheState> {
  const current = await loadCache();
  const byId = new Map<string, Article>();
  for (const art of current.articles) byId.set(art.id, art);
  for (const art of incoming) {
    const prev = byId.get(art.id);
    byId.set(art.id, prev ? { ...art, read: prev.read } : art);
  }
  const articles = [...byId.values()]
    .sort((a, b) => (b.pubDate || b.fetchedAt).localeCompare(a.pubDate || a.fetchedAt))
    .slice(0, 500);
  const next = { ...current, articles, lastRefresh: new Date().toISOString() };
  await saveCache(next);
  return next;
}

export async function setRead(id: string, read: boolean): Promise<CacheState> {
  const current = await loadCache();
  current.articles = current.articles.map((a) => (a.id === id ? { ...a, read } : a));
  await saveCache(current);
  return current;
}
