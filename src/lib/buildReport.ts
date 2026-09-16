import { createHash } from "crypto";
import { convertFilledDocxToPdf } from "./docxToPdf";
import { buildExactPair } from "./exportExact";
import { fillSampleDocx } from "./fillSampleDocx";
import { repairPdfLinkUris, reportUrls } from "./pdfLinks";
import type { ReportPayload } from "./reportPayload";

export type ReportFiles = {
  word: Uint8Array;
  wordMime: string;
  wordFilename: string;
  pdf: Uint8Array;
};

type CacheEntry = ReportFiles & { key: string; at: number };

let inflight: Promise<ReportFiles> | null = null;
let cache: CacheEntry | null = null;

function cacheKey(payload: ReportPayload): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        dateStamp: payload.dateStamp,
        topItems: payload.topItems,
        sections: payload.sections,
      }),
    )
    .digest("hex");
}

function payloadUrls(payload: ReportPayload): string[] {
  return [...reportUrls(payload.topItems), ...payload.sections.flatMap((section) => reportUrls(section.items))];
}

async function buildFromFilledSample(payload: ReportPayload): Promise<ReportFiles> {
  const docx = await fillSampleDocx(payload);
  const pdfRaw = await convertFilledDocxToPdf(docx, payload);
  const pdf = await repairPdfLinkUris(pdfRaw, payloadUrls(payload));
  return {
    word: docx,
    wordMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    wordFilename: `${payload.basename}.docx`,
    pdf,
  };
}

export async function buildReportFiles(payload: ReportPayload): Promise<ReportFiles> {
  const key = cacheKey(payload);
  if (cache && cache.key === key && Date.now() - cache.at < 25_000) {
    return { word: cache.word, wordMime: cache.wordMime, wordFilename: cache.wordFilename, pdf: cache.pdf };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const exact = await buildExactPair(payload);
      const files = exact
        ? {
            word: exact.doc,
            wordMime: "application/msword",
            wordFilename: `${payload.basename}.doc`,
            pdf: exact.pdf,
          }
        : await buildFromFilledSample(payload);
      cache = { ...files, key, at: Date.now() };
      return files;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
