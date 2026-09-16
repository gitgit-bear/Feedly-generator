import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFPage, PDFString } from "pdf-lib";

export function addUriLink(page: PDFPage, x: number, y: number, width: number, height: number, url: string) {
  if (!url || !/^https?:\/\//i.test(url) || width <= 0 || height <= 0) return;
  const annot = page.doc.context.register(
    page.doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y, x + width, y + height],
      Border: [0, 0, 0],
      F: 4,
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(url),
      },
    }),
  );
  page.node.addAnnot(annot);
}

function uriText(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return null;
}

function bestFullUrl(found: string, urls: string[]): string | null {
  const raw = found.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const stripped = raw.replace(/\/+$/, "");
  let best: string | null = null;
  for (const url of urls) {
    const full = url.trim();
    if (!full) continue;
    const fullStripped = full.replace(/\/+$/, "");
    if (fullStripped === stripped) return full;
    if (fullStripped.startsWith(stripped) && fullStripped.length > stripped.length) {
      if (!best || full.length > best.length) best = full;
    }
  }
  return best;
}

function payloadUrls(urls: string[]): string[] {
  return [...new Set(urls.map((url) => url.trim()).filter((url) => /^https?:\/\//i.test(url)))].sort(
    (a, b) => b.length - a.length,
  );
}

export async function repairPdfLinkUris(bytes: Uint8Array, urls: string[]): Promise<Uint8Array> {
  const known = payloadUrls(urls);
  if (!known.length) return bytes;
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  let changed = false;
  for (const page of pdf.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = pdf.context.lookup(annots.get(i));
      if (!(annot instanceof PDFDict)) continue;
      const action = annot.lookup(PDFName.of("A"));
      if (!(action instanceof PDFDict)) continue;
      const current = uriText(action.lookup(PDFName.of("URI")));
      if (!current) continue;
      const next = bestFullUrl(current, known);
      if (next && next !== current) {
        action.set(PDFName.of("URI"), PDFString.of(next));
        changed = true;
      }
    }
  }
  return changed ? pdf.save() : bytes;
}

export function reportUrls(items: Array<{ url?: string } | null | undefined>): string[] {
  return items.map((item) => item?.url ?? "").filter(Boolean);
}
