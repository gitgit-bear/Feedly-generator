import { promises as fs } from "fs";
import path from "path";
import type { Article, CacheState } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_PATH = path.join(DATA_DIR, "cache.json");

const EMPTY: CacheState = {
  articles: [],
  agencies: { hkcert: [], govcert: [], cybersechub: [] },
  lastRefresh: null,
};

export async function loadCache(): Promise<CacheState> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
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
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(state, null, 2), "utf8");
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
