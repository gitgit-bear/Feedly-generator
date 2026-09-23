import { fetchAgencies } from "@/lib/agencies";
import { fetchSource } from "@/lib/feeds";
import { polishGoogleNewsArticle } from "@/lib/googleNews";
import { dedupeStories, isToday, top10 } from "@/lib/rank";
import { SOURCES } from "@/lib/sources";
import { loadCache, mergeArticles, saveCache } from "@/lib/store";
import { unwrapArticleList } from "@/lib/unwrapGoogleNews";
import type { Article, CacheState, SourceHealth } from "@/lib/types";

const FRESH_MS = 15 * 60 * 1000;

export type NewsSnapshot = CacheState & {
  todayCount: number;
  top10: Article[];
};

export type CollectProgress = {
  done: number;
  total: number;
  sourceId: string;
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

function upsertHealth(list: SourceHealth[], next: SourceHealth): SourceHealth[] {
  const copy = list.filter((row) => row.id !== next.id);
  copy.push(next);
  return copy.sort((a, b) => a.name.localeCompare(b.name));
}

export async function collectNews(
  onProgress?: (progress: CollectProgress) => void,
  opts?: { skip?: string[] },
): Promise<CacheState> {
  const incoming: Article[] = [];
  const previous = await loadCache();
  let agencies = previous.agencies;
  let health = [...(previous.sourceHealth ?? [])];
  const skip = new Set(opts?.skip ?? []);
  const sources = SOURCES.filter((source) => !skip.has(source.id));
  const total = sources.length + (skip.has("agencies") ? 0 : 1);
  let done = 0;
  const now = new Date().toISOString();

  const feedTasks = sources.map(async (source) => {
    const result = await fetchSource(source);
    incoming.push(...result.articles);
    done += 1;
    health = upsertHealth(health, {
      id: source.id,
      name: source.name,
      ok: !result.error,
      error: result.error ?? null,
      count: result.articles.length,
      lastSync: now,
      url: source.url,
    });
    onProgress?.({
      done,
      total,
      sourceId: source.id,
      source: source.name,
      ok: !result.error,
      error: result.error ?? null,
      count: result.articles.length,
    });
    return result;
  });

  const tasks: Promise<unknown>[] = [...feedTasks];
  if (!skip.has("agencies")) {
    let agencyOk = true;
    tasks.push(
      fetchAgencies()
        .then((next) => {
          agencies = next;
        })
        .catch(() => {
          agencyOk = false;
        })
        .finally(() => {
          done += 1;
          const count = agencies.hkcert.length + agencies.govcert.length + agencies.cybersechub.length;
          health = upsertHealth(health, {
            id: "agencies",
            name: "HKCERT / GovCERT / Cybersechub",
            ok: agencyOk,
            error: agencyOk ? null : "Fetch failed",
            count,
            lastSync: now,
          });
          onProgress?.({
            done,
            total,
            sourceId: "agencies",
            source: "HKCERT / GovCERT / Cybersechub",
            ok: agencyOk,
            error: agencyOk ? null : "Fetch failed",
            count,
          });
        }),
    );
  }

  await Promise.allSettled(tasks);

  const merged = await mergeArticles(incoming);
  const unwrapped = await unwrapArticleList(merged.articles, 8000);
  const cache: CacheState = {
    ...merged,
    articles: dedupeStories(unwrapped.map(polishGoogleNewsArticle)),
    agencies,
    lastRefresh: now,
    sourceHealth: health,
  };
  await saveCache(cache);
  return cache;
}

export async function collectOneSource(sourceId: string): Promise<CacheState> {
  const previous = await loadCache();
  const now = new Date().toISOString();
  let health = [...(previous.sourceHealth ?? [])];

  if (sourceId === "agencies") {
    try {
      const agencies = await fetchAgencies();
      const count = agencies.hkcert.length + agencies.govcert.length + agencies.cybersechub.length;
      health = upsertHealth(health, {
        id: "agencies",
        name: "HKCERT / GovCERT / Cybersechub",
        ok: true,
        error: null,
        count,
        lastSync: now,
      });
      const cache: CacheState = { ...previous, agencies, lastRefresh: now, sourceHealth: health };
      await saveCache(cache);
      return cache;
    } catch (err) {
      health = upsertHealth(health, {
        id: "agencies",
        name: "HKCERT / GovCERT / Cybersechub",
        ok: false,
        error: err instanceof Error ? err.message : "Fetch failed",
        count: 0,
        lastSync: previous.sourceHealth?.find((row) => row.id === "agencies")?.lastSync ?? null,
      });
      const cache: CacheState = { ...previous, sourceHealth: health };
      await saveCache(cache);
      return cache;
    }
  }

  const source = SOURCES.find((row) => row.id === sourceId);
  if (!source) return previous;
  const result = await fetchSource(source);
  health = upsertHealth(health, {
    id: source.id,
    name: source.name,
    ok: !result.error,
    error: result.error ?? null,
    count: result.articles.length,
    lastSync: now,
    url: source.url,
  });
  if (!result.articles.length) {
    const cache: CacheState = { ...previous, sourceHealth: health };
    await saveCache(cache);
    return cache;
  }
  const merged = await mergeArticles(result.articles);
  const unwrapped = await unwrapArticleList(merged.articles, 4000);
  const cache: CacheState = {
    ...merged,
    articles: dedupeStories(unwrapped.map(polishGoogleNewsArticle)),
    agencies: previous.agencies,
    lastRefresh: now,
    sourceHealth: health,
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
