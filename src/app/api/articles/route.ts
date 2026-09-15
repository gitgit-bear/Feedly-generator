import { NextResponse } from "next/server";
import { loadCache } from "@/lib/store";
import { isToday, top10 } from "@/lib/rank";

export async function GET() {
  const cache = await loadCache();
  return NextResponse.json({
    ...cache,
    todayCount: cache.articles.filter((a) => isToday(a.pubDate || a.fetchedAt)).length,
    top10: top10(cache.articles),
  });
}
