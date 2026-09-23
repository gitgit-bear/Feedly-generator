import { NextResponse } from "next/server";
import { COLLECT_TOTAL, asSnapshot, collectNews, collectOneSource } from "@/lib/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const wantJson = req.headers.get("accept")?.includes("application/json");
  const body = await req.json().catch(() => null) as { sourceId?: string; skip?: string[] } | null;
  if (body?.sourceId) {
    const cache = await collectOneSource(body.sourceId);
    return NextResponse.json({ snapshot: asSnapshot(cache) });
  }

  if (wantJson) {
    const cache = await collectNews(undefined, { skip: body?.skip });
    return NextResponse.json({ snapshot: asSnapshot(cache) });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(sse(payload)));
      try {
        send({ type: "start", total: COLLECT_TOTAL });
        let failed = 0;
        const cache = await collectNews((progress) => {
          if (progress.ok === false) failed += 1;
          send({ type: "progress", ...progress });
        }, { skip: body?.skip });
        send({
          type: "done",
          articles: cache.articles.length,
          failed,
          lastRefresh: cache.lastRefresh,
          snapshot: asSnapshot(cache),
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Refresh failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
