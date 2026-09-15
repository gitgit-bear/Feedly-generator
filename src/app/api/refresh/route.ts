import { fetchSource } from "@/lib/feeds";
import { fetchAgencies } from "@/lib/agencies";
import { SOURCES } from "@/lib/sources";
import { loadCache, mergeArticles, saveCache } from "@/lib/store";
import type { Article } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(sse(payload)));
      const incoming: Article[] = [];
      const total = SOURCES.length + 1;
      let done = 0;

      send({ type: "start", total });

      const results = await Promise.all(
        SOURCES.map(async (source) => {
          const result = await fetchSource(source);
          incoming.push(...result.articles);
          done += 1;
          send({
            type: "progress",
            done,
            total,
            source: source.name,
            ok: !result.error,
            error: result.error ?? null,
            count: result.articles.length,
          });
          return result;
        }),
      );

      send({ type: "progress", done, total, source: "HKCERT / GovCERT / Cybersechub" });
      const agencies = await fetchAgencies();
      done += 1;
      send({ type: "progress", done, total, source: "Agencies", ok: true });

      const cache = await mergeArticles(incoming);
      cache.agencies = agencies;
      cache.lastRefresh = new Date().toISOString();
      await saveCache(cache);

      const failed = results.filter((r) => r.error).length;
      const latest = await loadCache();
      send({
        type: "done",
        articles: latest.articles.length,
        failed,
        lastRefresh: latest.lastRefresh,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
