import { NextResponse } from "next/server";
import { loadCacheOrCollect } from "@/lib/collect";
import { buildWeeklyBriefPdf } from "@/lib/exportWeeklyPdf";
import { buildWeeklyBrief, isWeeklyBrief } from "@/lib/weeklyBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fileResponse(bytes: Uint8Array, filename: string) {
  const safe = filename.replace(/"/g, "");
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/\s+/g, "_");
  const encoded = encodeURIComponent(safe);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encoded}.pdf`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function pdfFromCache() {
  const cache = await loadCacheOrCollect();
  const brief = buildWeeklyBrief(cache.articles);
  const bytes = await buildWeeklyBriefPdf(brief);
  return { brief, bytes };
}

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const { brief, bytes } = await pdfFromCache();
  if (format === "pdf") {
    return fileResponse(bytes, brief.basename);
  }
  return NextResponse.json(brief, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const brief = isWeeklyBrief(body) ? body : null;
  if (!brief) {
    const built = await pdfFromCache();
    return fileResponse(built.bytes, built.brief.basename);
  }
  const bytes = await buildWeeklyBriefPdf(brief);
  return fileResponse(bytes, brief.basename);
}
