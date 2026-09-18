import { newsletterFileStamp } from "./reportPayload";
import type { WeeklyBrief } from "./weeklyBrief";

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

type SavePickerOptions = {
  suggestedName?: string;
  id?: string;
  startIn?: FileSystemHandle;
  excludeAcceptAllOption?: boolean;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
};

type DirHandle = FileSystemDirectoryHandle & {
  requestPermission?: (opts: { mode: "readwrite" | "read" }) => Promise<PermissionState>;
};

function canUseSavePicker(): boolean {
  const w = window as Window & { showSaveFilePicker?: unknown };
  return typeof w.showSaveFilePicker === "function" && !isMobileBrowser();
}

function fileStem(name: string): string {
  return name.replace(/\.(pdf|docx?)$/i, "");
}

function isPdfName(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

async function saveViaPicker(
  kind: ExportKind,
  extra?: { startIn?: FileSystemHandle; suggestedName?: string },
): Promise<FileSystemFileHandle | null> {
  if (!canUseSavePicker()) return null;
  const stamp = newsletterFileStamp();
  const docName = `Feedly News Letter ${stamp}.doc`;
  const pdfName = `Feedly News Letter ${stamp}.pdf`;
  const w = window as Window & {
    showSaveFilePicker?: (opts?: SavePickerOptions) => Promise<FileSystemFileHandle>;
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
      id: "feedly-export",
      suggestedName: extra?.suggestedName ?? (kind === "pdf" ? pdfName : docName),
      startIn: extra?.startIn,
      excludeAcceptAllOption: true,
      types,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    return null;
  }
}

async function directoryOf(handle: FileSystemFileHandle): Promise<FileSystemDirectoryHandle | null> {
  const file = handle as FileSystemFileHandle & { getParent?: () => Promise<DirHandle> };
  if (typeof file.getParent !== "function") return null;
  try {
    const dir = await file.getParent();
    if (typeof dir.requestPermission === "function") {
      const perm = await dir.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") return null;
    }
    return dir;
  } catch {
    return null;
  }
}

async function writeNamed(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const file = await dir.getFileHandle(name, { create: true });
  await writeFile(file, bytes, mime);
  return file.name;
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

export type ExportProgress = (pct: number, label?: string) => void;

export async function exportReportFormat(kind: ExportKind, onProgress?: ExportProgress): Promise<SaveResult> {
  const note = (pct: number, label?: string) => onProgress?.(pct, label);
  if (isMobileBrowser()) {
    const stamp = newsletterFileStamp();
    const names =
      kind === "pdf"
        ? [`Feedly News Letter ${stamp}.pdf`]
        : kind === "docx"
          ? [`Feedly News Letter ${stamp}.doc`]
          : [`Feedly News Letter ${stamp}.pdf`, `Feedly News Letter ${stamp}.doc`];
    try {
      note(12, "Building report…");
      if (kind !== "both") {
        const file = await fetchReport(kind);
        note(88, "Saving…");
        const shared = await shareFiles([toFile(file.bytes, file.name, file.mime)]);
        if (shared === "shared") return { status: "saved", files: names };
        if (shared === "cancelled") return { status: "cancelled" };
        downloadBlob(file.bytes, file.name, file.mime);
        openServerDownload(kind);
        note(100);
        return { status: "saved", files: names };
      }
      const { pdf, docx } = await fetchReportPair();
      note(88, "Saving…");
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
      note(100);
      return { status: "saved", files: names };
    } catch (err) {
      if (isAbort(err)) return { status: "cancelled" };
      if (kind === "pdf" || kind === "docx") openServerDownload(kind);
      else {
        openServerDownload("pdf");
        openServerDownload("docx");
      }
      note(100);
      return { status: "saved", files: names };
    }
  }
  let handle: FileSystemFileHandle | null = null;
  let siblingHandle: FileSystemFileHandle | null = null;
  let siblingDir: FileSystemDirectoryHandle | null = null;
  try {
    note(8, "Choose save location…");
    handle = await saveViaPicker(kind);
    if (handle && kind === "both") {
      siblingDir = await directoryOf(handle);
      if (!siblingDir) {
        const other = isPdfName(handle.name) ? "docx" : "pdf";
        siblingHandle = await saveViaPicker(other, {
          startIn: handle,
          suggestedName: `${fileStem(handle.name)}.${other === "pdf" ? "pdf" : "doc"}`,
        });
      }
    }
  } catch (err) {
    if (isAbort(err)) return { status: "cancelled" };
  }

  let docx: Awaited<ReturnType<typeof fetchReport>> | null = null;
  let pdf: Awaited<ReturnType<typeof fetchReport>> | null = null;
  try {
    note(22, "Building report…");
    if (kind === "docx") docx = await fetchReport("docx");
    else if (kind === "pdf") pdf = await fetchReport("pdf");
    else {
      const pair = await fetchReportPair();
      docx = pair.docx;
      pdf = pair.pdf;
    }
    note(86, "Saving files…");
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Export failed" };
  }

  if (handle) {
    try {
      const primaryIsPdf = isPdfName(handle.name);
      const primary = primaryIsPdf ? pdf : docx;
      const secondary = primaryIsPdf ? docx : pdf;
      if (primary) {
        await writeFile(handle, primary.bytes, primaryIsPdf ? PDF_MIME : WORD_MIME);
        const saved = [handle.name];
        if (kind === "both" && secondary) {
          const secondaryName = `${fileStem(handle.name)}.${primaryIsPdf ? "doc" : "pdf"}`;
          const secondaryMime = primaryIsPdf ? WORD_MIME : PDF_MIME;
          if (siblingDir && saved.length === 1) {
            try {
              saved.push(await writeNamed(siblingDir, secondaryName, secondary.bytes, secondaryMime));
            } catch {
              /* fall through to the other handle / picker */
            }
          }
          if (siblingHandle && saved.length === 1) {
            try {
              await writeFile(siblingHandle, secondary.bytes, secondaryMime);
              saved.push(siblingHandle.name);
            } catch {
              /* fall through to a second save dialog */
            }
          }
          if (saved.length === 1) {
            try {
              const extra = await saveViaPicker(primaryIsPdf ? "docx" : "pdf", {
                startIn: handle,
                suggestedName: secondaryName,
              });
              if (extra) {
                await writeFile(extra, secondary.bytes, secondaryMime);
                saved.push(extra.name);
              }
            } catch (err) {
              if (!isAbort(err)) throw err;
            }
          }
        }
        note(100);
        return { status: "saved", files: saved };
      }
    } catch (err) {
      if (isAbort(err)) return { status: "cancelled" };
    }
  }

  const files = [
    ...(pdf ? [{ ...pdf, format: "pdf" as const }] : []),
    ...(docx ? [{ ...docx, format: "docx" as const }] : []),
  ];
  note(92, "Saving files…");
  const result = await deliverFiles(files);
  if (result.status === "saved") note(100);
  return result;
}

export function weeklyBriefDownloadUrl(): string {
  return "/api/weekly-brief?format=pdf&dl=1";
}

export async function exportWeeklyBriefPdf(
  brief: WeeklyBrief,
  onProgress?: ExportProgress,
): Promise<SaveResult> {
  const note = (pct: number, label?: string) => onProgress?.(pct, label);
  note(12, "Building weekly brief…");
  let handle: FileSystemFileHandle | null = null;
  if (!isMobileBrowser()) {
    try {
      handle = await saveViaPicker("pdf", { suggestedName: `${brief.basename}.pdf` });
    } catch (err) {
      if (isAbort(err)) return { status: "cancelled" };
    }
  }
  note(40, "Building one-page PDF…");
  const res = await fetch("/api/weekly-brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(brief),
    cache: "no-store",
  });
  if (!res.ok) {
    return { status: "error", message: `Could not build weekly brief (${res.status})` };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const name = `${brief.basename}.pdf`;
  note(86, "Saving PDF…");
  if (handle) {
    try {
      await writeFile(handle, bytes, PDF_MIME);
      note(100);
      return { status: "saved", files: [handle.name] };
    } catch (err) {
      if (isAbort(err)) return { status: "cancelled" };
    }
  }
  if (isMobileBrowser()) {
    const shared = await shareFiles([toFile(bytes, name, PDF_MIME)]);
    if (shared === "shared") return { status: "saved", files: [name] };
    if (shared === "cancelled") return { status: "cancelled" };
    downloadBlob(bytes, name, PDF_MIME);
    note(100);
    return { status: "saved", files: [name] };
  }
  downloadBlob(bytes, name, PDF_MIME);
  note(100);
  return { status: "saved", files: [name] };
}
