import type { ExactPair } from "./exportExact";
import type { ReportPayload } from "./reportPayload";

function converterUrl(): string | null {
  const raw = process.env.WORD_CONVERTER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/\.vercel\.app$/i.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function converterSecret(): string | null {
  const secret = process.env.WORD_CONVERTER_SECRET?.trim();
  return secret || null;
}

export async function fetchRemoteWordPair(payload: ReportPayload): Promise<ExactPair | null> {
  const base = converterUrl();
  const secret = converterSecret();
  if (!base || !secret) return null;
  try {
    const res = await fetch(`${base}/api/word-pair`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
        "x-cyberguard-word-pair": "1",
      },
      body: JSON.stringify({ payload }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`Word converter HTTP ${res.status}`);
    }
    const data = (await res.json()) as { doc?: string; pdf?: string };
    if (!data.doc || !data.pdf) {
      throw new Error("Word converter returned an empty pair");
    }
    return {
      doc: Uint8Array.from(Buffer.from(data.doc, "base64")),
      pdf: Uint8Array.from(Buffer.from(data.pdf, "base64")),
    };
  } catch (err) {
    console.error("[report] Remote Word converter failed", err);
    return null;
  }
}
