import { fetchAgencies } from "@/lib/agencies";
import { fetchSource } from "@/lib/feeds";
import { SOURCES } from "@/lib/sources";
import { loadCache, mergeArticles, saveCache } from "@/lib/store";
import type { Article, CacheState } from "@/lib/types";

const FRESH_MS = 15 * 60 * 1000;

export async function collectNews(): Promise<CacheState> {
  const incoming: Article[] = [];
  const results = await Promise.all(SOURCES.map((source) => fetchSource(source)));
  for (const result of results) incoming.push(...result.articles);
  const agencies = await fetchAgencies();
  const cache = await mergeArticles(incoming);
  cache.agencies = agencies;
  cache.lastRefresh = new Date().toISOString();
  await saveCache(cache);
  return cache;
}

export async function loadCacheOrCollect(): Promise<CacheState> {
  const cache = await loadCache();
  const age = cache.lastRefresh ? Date.now() - new Date(cache.lastRefresh).getTime() : Number.POSITIVE_INFINITY;
  if (cache.articles.length && Number.isFinite(age) && age < FRESH_MS) return cache;
  return collectNews();
}
