import { NextResponse } from "next/server";
import { asSnapshot, loadCacheOrCollect } from "@/lib/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const cache = await loadCacheOrCollect();
  return NextResponse.json(asSnapshot(cache));
}
