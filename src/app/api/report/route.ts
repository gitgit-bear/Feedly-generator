import { NextResponse } from "next/server";
import { loadCacheOrCollect } from "@/lib/collect";
import { renderReportHtml } from "@/lib/report";
import { buildReportFiles } from "@/lib/buildReport";
import { buildReportPayload } from "@/lib/reportPayload";
import { unwrapReportPayload } from "@/lib/unwrapGoogleNews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fileResponse(bytes: Uint8Array, mime: string, filename: string) {
  const safe = filename.replace(/"/g, "");
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/\s+/g, "_");
  const encoded = encodeURIComponent(safe);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format") ?? "html";
  const cache = await loadCacheOrCollect();

  const payload = await unwrapReportPayload(buildReportPayload(cache.articles, cache.agencies));

  if (format === "html") {
    return new NextResponse(renderReportHtml(payload), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${payload.basename}.html"`,
      },
    });
  }

  if (format === "both" || format === "pair") {
    const files = await buildReportFiles(payload);
    return NextResponse.json(
      {
        word: Buffer.from(files.word).toString("base64"),
        wordMime: files.wordMime,
        wordFilename: files.wordFilename,
        pdf: Buffer.from(files.pdf).toString("base64"),
        pdfFilename: `${payload.basename}.pdf`,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }

  if (format === "pdf" || format === "docx" || format === "doc") {
    const files = await buildReportFiles(payload);
    if (format === "pdf") {
      return fileResponse(files.pdf, "application/pdf", `${payload.basename}.pdf`);
    }
    return fileResponse(files.word, files.wordMime, files.wordFilename);
  }

  return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
}
