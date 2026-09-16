import { newsletterFileStamp } from "./reportPayload";

export type ExportKind = "pdf" | "docx" | "both";

export type SaveResult =
  | { status: "saved"; folder?: string; files: string[] }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export const WORD_MIME = "application/msword";
export const PDF_MIME = "application/pdf";

export function reportDownloadUrl(format: "pdf" | "docx" | "both"): string {
  const value = format === "docx" ? "doc" : format === "both" ? "both" : "pdf";
  return `/api/report?format=${value}&dl=1`;
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Android|Mobile|webOS|Silk/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua);
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function toBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: mime });
}

function toFile(bytes: Uint8Array, filename: string, mime: string): File {
  return new File([toBlob(bytes, mime)], filename, { type: mime, lastModified: Date.now() });
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function filenameFrom(res: Response, fallback: string): string {
  const header = res.headers.get("Content-Disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* keep looking */
    }
  }
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] || fallback;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

type ReportFile = { bytes: Uint8Array; name: string; mime: string };

export async function fetchReport(format: "docx" | "pdf"): Promise<ReportFile> {
  const res = await fetch(reportDownloadUrl(format), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not build ${format.toUpperCase()} (${res.status})`);
  }
  const fallbackMime = format === "pdf" ? PDF_MIME : WORD_MIME;
  const mime = res.headers.get("Content-Type")?.split(";")[0].trim() || fallbackMime;
  const fallback = format === "pdf" ? "Feedly News Letter.pdf" : "Feedly News Letter.doc";
  return { bytes: new Uint8Array(await res.arrayBuffer()), name: filenameFrom(res, fallback), mime };
}

export async function fetchReportPair(): Promise<{ pdf: ReportFile; docx: ReportFile }> {
  const res = await fetch(reportDownloadUrl("both"), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not build report (${res.status})`);
  }
  const data = (await res.json()) as {
    word?: string;
    pdf?: string;
    wordMime?: string;
    wordFilename?: string;
    pdfFilename?: string;
    error?: string;
  };
  if (!data.word || !data.pdf) {
    throw new Error(data.error || "Could not build Word + PDF");
  }
  return {
    pdf: {
      bytes: fromBase64(data.pdf),
      name: data.pdfFilename || "Feedly News Letter.pdf",
      mime: PDF_MIME,
    },
    docx: {
      bytes: fromBase64(data.word),
      name: data.wordFilename || "Feedly News Letter.doc",
      mime: data.wordMime || WORD_MIME,
    },
  };
}

function openServerDownload(format: "pdf" | "docx") {
  const a = document.createElement("a");
  a.href = reportDownloadUrl(format);
  a.target = "_blank";
  a.rel = "noopener";
  a.download = format === "pdf" ? "Feedly News Letter.pdf" : "Feedly News Letter.doc";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadBlob(bytes: Uint8Array, filename: string, mime: string) {
  const url = URL.createObjectURL(toBlob(bytes, mime));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function writeFile(handle: FileSystemFileHandle, bytes: Uint8Array, mime: string) {
  const writable = await handle.createWritable();
  await writable.write(toBlob(bytes, mime));
  await writable.close();
}

async function shareFiles(files: File[]): Promise<"shared" | "cancelled" | "skipped"> {
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  try {
    if (!nav.share || !nav.canShare?.({ files })) return "skipped";
    await nav.share({ files, title: files.length === 1 ? files[0].name : "Feedly News Letter" });
    return "shared";
  } catch (err) {
    if (isAbort(err)) return "cancelled";
    return "skipped";
  }
}

function canUseSavePicker(): boolean {
  const w = window as Window & { showSaveFilePicker?: unknown };
  return typeof w.showSaveFilePicker === "function" && !isMobileBrowser();
}

async function saveViaPicker(kind: ExportKind): Promise<FileSystemFileHandle | null> {
  if (!canUseSavePicker()) return null;
  const stamp = newsletterFileStamp();
  const docName = `Feedly News Letter ${stamp}.doc`;
  const pdfName = `Feedly News Letter ${stamp}.pdf`;
  const w = window as Window & {
    showSaveFilePicker?: (opts?: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle>;
  };
  const wordType = {
    description: "Word 97-2003 Document",
    accept: {
      [WORD_MIME]: [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
  };
  const pdfType = { description: "PDF", accept: { [PDF_MIME]: [".pdf"] } };
  const types = kind === "pdf" ? [pdfType] : kind === "docx" ? [wordType] : [wordType, pdfType];
  try {
    return await w.showSaveFilePicker!({
      suggestedName: kind === "pdf" ? pdfName : docName,
      types,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    return null;
  }
}

async function deliverFiles(
  files: Array<{ bytes: Uint8Array; name: string; mime: string; format: "pdf" | "docx" }>,
): Promise<SaveResult> {
  const shared = await shareFiles(files.map((f) => toFile(f.bytes, f.name, f.mime)));
  if (shared === "shared") return { status: "saved", files: files.map((f) => f.name) };
  if (shared === "cancelled") return { status: "cancelled" };

  if (isIos() || isMobileBrowser()) {
    for (const file of files) {
      openServerDownload(file.format);
      await new Promise((r) => setTimeout(r, 650));
    }
    return { status: "saved", files: files.map((f) => f.name) };
  }

  for (const file of files) {
    downloadBlob(file.bytes, file.name, file.mime);
    await new Promise((r) => setTimeout(r, 350));
  }
  return { status: "saved", files: files.map((f) => f.name) };
}

export async function exportReportFormat(kind: ExportKind): Promise<SaveResult> {
  if (isMobileBrowser()) {
    const stamp = newsletterFileStamp();
    const names =
      kind === "pdf"
        ? [`Feedly News Letter ${stamp}.pdf`]
        : kind === "docx"
          ? [`Feedly News Letter ${stamp}.doc`]
          : [`Feedly News Letter ${stamp}.pdf`, `Feedly News Letter ${stamp}.doc`];
    try {
      if (kind !== "both") {
        const file = await fetchReport(kind);
        const shared = await shareFiles([toFile(file.bytes, file.name, file.mime)]);
        if (shared === "shared") return { status: "saved", files: names };
        if (shared === "cancelled") return { status: "cancelled" };
        downloadBlob(file.bytes, file.name, file.mime);
        openServerDownload(kind);
        return { status: "saved", files: names };
      }
      const { pdf, docx } = await fetchReportPair();
      const shared = await shareFiles([
        toFile(pdf.bytes, pdf.name, pdf.mime),
        toFile(docx.bytes, docx.name, docx.mime),
      ]);
      if (shared === "shared") return { status: "saved", files: names };
      if (shared === "cancelled") return { status: "cancelled" };
      downloadBlob(pdf.bytes, pdf.name, pdf.mime);
      downloadBlob(docx.bytes, docx.name, docx.mime);
      openServerDownload("pdf");
      openServerDownload("docx");
      return { status: "saved", files: names };
    } catch (err) {
      if (isAbort(err)) return { status: "cancelled" };
      if (kind === "pdf" || kind === "docx") openServerDownload(kind);
      else {
        openServerDownload("pdf");
        openServerDownload("docx");
      }
      return { status: "saved", files: names };
    }
  }
  let handle: FileSystemFileHandle | null = null;
  try {
    handle = await saveViaPicker(kind);
  } catch (err) {
    if (isAbort(err)) return { status: "cancelled" };
  }

  let docx: Awaited<ReturnType<typeof fetchReport>> | null = null;
  let pdf: Awaited<ReturnType<typeof fetchReport>> | null = null;
  try {
    if (kind === "docx") docx = await fetchReport("docx");
    else if (kind === "pdf") pdf = await fetchReport("pdf");
    else {
      const pair = await fetchReportPair();
      docx = pair.docx;
      pdf = pair.pdf;
    }
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Export failed" };
  }

  if (handle) {
    try {
      const lower = handle.name.toLowerCase();
      if (lower.endsWith(".pdf") && pdf) {
        await writeFile(handle, pdf.bytes, PDF_MIME);
        if (docx && kind === "both") downloadBlob(docx.bytes, docx.name, WORD_MIME);
        return { status: "saved", files: [handle.name, ...(kind === "both" && docx ? [docx.name] : [])] };
      }
      if (docx) {
        await writeFile(handle, docx.bytes, WORD_MIME);
        if (pdf && kind === "both") downloadBlob(pdf.bytes, pdf.name, PDF_MIME);
        return { status: "saved", files: [handle.name, ...(kind === "both" && pdf ? [pdf.name] : [])] };
      }
    } catch (err) {
      if (isAbort(err)) return { status: "cancelled" };
    }
  }

  const files = [
    ...(pdf ? [{ ...pdf, format: "pdf" as const }] : []),
    ...(docx ? [{ ...docx, format: "docx" as const }] : []),
  ];
  return deliverFiles(files);
}
