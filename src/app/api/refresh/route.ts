import { NextResponse } from "next/server";
import { COLLECT_TOTAL, asSnapshot, collectNews } from "@/lib/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const wantJson = req.headers.get("accept")?.includes("application/json");
  if (wantJson) {
    const cache = await collectNews();
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
        });
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
