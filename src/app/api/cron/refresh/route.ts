import { NextResponse } from "next/server";
import { asSnapshot, collectNews } from "@/lib/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.VERCEL !== "1";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const header = req.headers.get("x-cron-secret") ?? "";
  return bearer === secret || header === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cache = await collectNews(undefined, { skip: [] });
  return NextResponse.json({
    ok: true,
    lastRefresh: cache.lastRefresh,
    articles: cache.articles.length,
    enrichment: Object.keys(cache.enrichment ?? {}).length,
    persistBackend: cache.persistBackend ?? null,
    snapshot: asSnapshot(cache),
  });
}
