import { NextResponse } from "next/server";
import { loadCache } from "@/lib/store";
import { renderReportHtml } from "@/lib/report";
import { buildReportDocx } from "@/lib/exportDocx";
import { buildReportPdf } from "@/lib/exportPdf";
import { buildExactPair } from "@/lib/exportExact";
import { buildReportPayload } from "@/lib/reportPayload";

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
  const cache = await loadCache();

  if (format === "html") {
    const html = renderReportHtml(cache.articles, cache.agencies);
    const stamp = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="Feedly News Letter ${stamp}.html"`,
      },
    });
  }

  const payload = buildReportPayload(cache.articles, cache.agencies);
  const exact = format === "pdf" || format === "docx" || format === "doc" ? await buildExactPair(payload) : null;

  if (format === "pdf") {
    const bytes = exact?.pdf ?? (await buildReportPdf(payload));
    return fileResponse(bytes, "application/pdf", `${payload.basename}.pdf`);
  }
  if (format === "docx" || format === "doc") {
    if (exact?.doc) {
      return fileResponse(exact.doc, "application/msword", `${payload.basename}.doc`);
    }
    return fileResponse(
      await buildReportDocx(payload),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      `${payload.basename}.docx`,
    );
  }

  return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
}
