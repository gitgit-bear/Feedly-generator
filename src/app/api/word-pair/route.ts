import { NextResponse } from "next/server";
import { buildExactPair } from "@/lib/exportExact";
import type { ReportPayload } from "@/lib/reportPayload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  let secret = process.env.WORD_CONVERTER_SECRET?.trim() ?? "";
  if (!secret) {
    try {
      const text = require("fs").readFileSync(require("path").join(process.cwd(), ".env.local"), "utf8") as string;
      const line = text.split(/\r?\n/).find((item) => item.startsWith("WORD_CONVERTER_SECRET="));
      secret = line?.slice("WORD_CONVERTER_SECRET=".length).trim() ?? "";
    } catch {
      secret = "";
    }
  }
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (process.env.VERCEL || process.platform !== "win32") {
    return NextResponse.json({ error: "Word converter is Windows-only" }, { status: 404 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ReportPayload;
  try {
    const body = (await req.json()) as { payload?: ReportPayload };
    if (!body.payload?.basename || !Array.isArray(body.payload.topItems)) {
      throw new Error("Missing payload");
    }
    payload = body.payload;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const pair = await buildExactPair(payload);
  if (!pair) {
    return NextResponse.json({ error: "Word conversion failed" }, { status: 503 });
  }

  return NextResponse.json({
    doc: Buffer.from(pair.doc).toString("base64"),
    pdf: Buffer.from(pair.pdf).toString("base64"),
    wordMime: "application/msword",
    wordFilename: `${payload.basename}.doc`,
  });
}
