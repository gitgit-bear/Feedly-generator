import { fetchAgencies } from "@/lib/agencies";
import { fetchSource } from "@/lib/feeds";
import { polishGoogleNewsArticle } from "@/lib/googleNews";
import { dedupeStories, isToday, top10 } from "@/lib/rank";
import { SOURCES } from "@/lib/sources";
import { loadCache, mergeArticles, saveCache } from "@/lib/store";
import { unwrapArticleList } from "@/lib/unwrapGoogleNews";
import type { Article, CacheState } from "@/lib/types";

const FRESH_MS = 15 * 60 * 1000;

export type NewsSnapshot = CacheState & {
  todayCount: number;
  top10: Article[];
};

export type CollectProgress = {
  done: number;
  total: number;
  source: string;
  ok?: boolean;
  error?: string | null;
  count?: number;
};

export const COLLECT_TOTAL = SOURCES.length + 1;

export function asSnapshot(cache: CacheState): NewsSnapshot {
  const articles = dedupeStories(cache.articles.map(polishGoogleNewsArticle));
  return {
    ...cache,
    articles,
    todayCount: articles.filter((a) => isToday(a.pubDate || a.fetchedAt)).length,
    top10: top10(articles),
  };
}

export async function collectNews(onProgress?: (progress: CollectProgress) => void): Promise<CacheState> {
  const incoming: Article[] = [];
  const previous = await loadCache();
  let agencies = previous.agencies;
  const total = COLLECT_TOTAL;
  let done = 0;

  const feedTasks = SOURCES.map(async (source) => {
    const result = await fetchSource(source);
    incoming.push(...result.articles);
    done += 1;
    onProgress?.({
      done,
      total,
      source: source.name,
      ok: !result.error,
      error: result.error ?? null,
      count: result.articles.length,
    });
    return result;
  });

  let agencyOk = true;
  const agencyTask = fetchAgencies()
    .then((next) => {
      agencies = next;
    })
    .catch(() => {
      agencyOk = false;
    })
    .finally(() => {
      done += 1;
      onProgress?.({
        done,
        total,
        source: "HKCERT / GovCERT / Cybersechub",
        ok: agencyOk,
        error: agencyOk ? null : "Fetch failed",
      });
    });

  await Promise.allSettled([...feedTasks, agencyTask]);

  const merged = await mergeArticles(incoming);
  const unwrapped = await unwrapArticleList(merged.articles, 8000);
  const cache: CacheState = {
    ...merged,
    articles: dedupeStories(unwrapped.map(polishGoogleNewsArticle)),
    agencies,
    lastRefresh: new Date().toISOString(),
  };
  await saveCache(cache);
  return cache;
}

export async function loadCacheOrCollect(): Promise<CacheState> {
  const cache = await loadCache();
  const age = cache.lastRefresh ? Date.now() - new Date(cache.lastRefresh).getTime() : Number.POSITIVE_INFINITY;
  if (cache.articles.length && Number.isFinite(age) && age < FRESH_MS) return cache;
  return collectNews();
}
