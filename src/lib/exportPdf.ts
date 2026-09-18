import fs from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFImage, RGB, StandardFonts, rgb } from "pdf-lib";
import { addUriLink } from "./pdfLinks";
import type { ReportItem, ReportPayload } from "./reportPayload";

const TITLE = rgb(79 / 255, 79 / 255, 79 / 255);
const SOURCE = rgb(18 / 255, 162 / 255, 198 / 255);
const LINK = rgb(0, 0, 1);
const BLACK = rgb(0, 0, 0);
const DATE = rgb(51 / 255, 204 / 255, 51 / 255);

const PAGE: [number, number] = [595.3, 841.9];
const MARGIN = { top: 49.65, bottom: 35.45, left: 28.35, right: 28.3 };
const TABLE_W = 545.4;
const NUM_W = 33.75;
const BODY_W = TABLE_W - NUM_W;
const PAD_X = 5.4;
const PAD_Y = 2;
const SIZE = 13;
const LINE_H = 16;
const HEADER_DIST = 28.35;
const HEADER_W = 545;
const HEADER_H = 47.7;
const DATE_SIZE = 12;
const DATE_LEFT = 381.9;
const DATE_TOP = 13.6;

type Fonts = {
  body: PDFFont;
  heading: PDFFont;
  italic: PDFFont;
};

type Line = { text: string; font: PDFFont; color: RGB; underline?: boolean; href?: string };

type TableRow =
  | { kind: "heading"; text: string }
  | { kind: "spacer" }
  | { kind: "item"; n: number | null; item: ReportItem | null; section: boolean };

function latin(text: string): string {
  return Array.from(text || "")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13) return " ";
      if (code >= 32 && code <= 126) return ch;
      if (code >= 160 && code <= 255) return ch;
      const folded = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      return folded && folded.charCodeAt(0) < 256 ? folded : "?";
    })
    .join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const raw = latin(text || "");
  if (!raw) return [""];
  const words = raw.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  const pushChunk = (chunk: string) => {
    if (font.widthOfTextAtSize(chunk, size) <= maxWidth) {
      lines.push(chunk);
      return;
    }
    let buf = "";
    for (const ch of chunk) {
      const next = buf + ch;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) buf = next;
      else {
        if (buf) lines.push(buf);
        buf = ch;
      }
    }
    if (buf) lines.push(buf);
  };
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = "";
      if (font.widthOfTextAtSize(word, size) <= maxWidth) line = word;
      else pushChunk(word);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function readTemplate(name: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), "templates", name));
  } catch {
    return null;
  }
}

async function embedHeader(pdf: PDFDocument): Promise<PDFImage | null> {
  const jpg = readTemplate("feedly_header.jpg") ?? readTemplate(path.join("word", "media", "image1.jpeg"));
  if (jpg) {
    try {
      return await pdf.embedJpg(jpg);
    } catch {
      /* fall through */
    }
  }
  const png = readTemplate("feedly_header.png");
  if (png) {
    try {
      return await pdf.embedPng(png);
    } catch {
      return null;
    }
  }
  return null;
}

async function embedFonts(pdf: PDFDocument): Promise<Fonts> {
  const heading = await pdf.embedFont(StandardFonts.Helvetica);
  const regular = readTemplate(path.join("fonts", "Caladea-Regular.ttf"));
  const italicFile = readTemplate(path.join("fonts", "Caladea-Italic.ttf"));
  if (regular && italicFile) {
    try {
      pdf.registerFontkit(fontkit);
      return {
        body: await pdf.embedFont(regular),
        italic: await pdf.embedFont(italicFile),
        heading,
      };
    } catch {
      /* bundled TTF failed; Times is the fallback serif */
    }
  }
  return {
    body: await pdf.embedFont(StandardFonts.TimesRoman),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    heading,
  };
}

function itemLines(item: ReportItem | null, section: boolean, fonts: Fonts, maxW: number): Line[] {
  if (!item) {
    return [{ text: "Nil", font: fonts.italic, color: TITLE }];
  }
  const lines: Line[] = wrap(item.title, fonts.body, SIZE, maxW).map((text) => ({
    text,
    font: fonts.body,
    color: TITLE,
  }));
  if (!section) {
    for (const text of wrap(`${item.source} `, fonts.body, SIZE, maxW)) {
      lines.push({ text, font: fonts.body, color: SOURCE });
    }
  }
  for (const text of wrap(item.url, fonts.body, SIZE, maxW)) {
    lines.push({ text, font: fonts.body, color: LINK, underline: true, href: item.url });
  }
  lines.push({ text: " ", font: fonts.body, color: TITLE });
  return lines;
}

function rowHeight(lines: number): number {
  return Math.max(LINE_H + PAD_Y * 2, lines * LINE_H + PAD_Y * 2);
}

export async function buildReportPdf(payload: ReportPayload): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);
  const banner = await embedHeader(pdf);

  let page = pdf.addPage(PAGE);
  let y = page.getHeight() - MARGIN.top;
  const tableX = MARGIN.left;
  const textW = BODY_W - PAD_X * 2;

  const drawHeader = () => {
    const top = page.getHeight() - HEADER_DIST;
    if (banner) {
      const imageY = top - HEADER_H;
      page.drawImage(banner, {
        x: tableX,
        y: imageY,
        width: HEADER_W,
        height: HEADER_H,
      });
      const date = ` ${payload.dateStamp}`;
      page.drawText(date, {
        x: tableX + DATE_LEFT,
        y: top - DATE_TOP - DATE_SIZE * 0.78,
        size: DATE_SIZE,
        font: fonts.heading,
        color: DATE,
      });
      y = imageY - 8;
      return;
    }
    page.drawText(` ${payload.dateStamp}`, {
      x: tableX + TABLE_W - fonts.heading.widthOfTextAtSize(` ${payload.dateStamp}`, DATE_SIZE) - 8,
      y: top - DATE_SIZE,
      size: DATE_SIZE,
      font: fonts.heading,
      color: DATE,
    });
    y = top - 28;
  };

  const newPage = () => {
    page = pdf.addPage(PAGE);
    drawHeader();
  };

  const ensure = (need: number) => {
    if (y - need < MARGIN.bottom) newPage();
  };

  const drawLines = (lines: Line[], x: number, top: number) => {
    let cy = top - PAD_Y - SIZE;
    for (const line of lines) {
      page.drawText(line.text, { x, y: cy, size: SIZE, font: line.font, color: line.color });
      if (line.underline) {
        const w = line.font.widthOfTextAtSize(line.text, SIZE);
        page.drawLine({
          start: { x, y: cy - 1 },
          end: { x: x + w, y: cy - 1 },
          thickness: 0.6,
          color: line.color,
        });
        if (line.href) addUriLink(page, x, cy - 3, Math.max(w, 8), SIZE + 4, line.href);
      }
      cy -= LINE_H;
    }
  };

  const drawHeading = (text: string) => {
    const h = rowHeight(1);
    ensure(h);
    page.drawText(latin(text), {
      x: tableX,
      y: y - PAD_Y - SIZE,
      size: SIZE,
      font: fonts.heading,
      color: BLACK,
    });
    y -= h;
  };

  const drawItem = (row: Extract<TableRow, { kind: "item" }>) => {
    const lines = itemLines(row.item, row.section, fonts, textW);
    const h = rowHeight(lines.length);
    ensure(h);
    if (row.n != null) {
      page.drawText(`${row.n}.`, {
        x: tableX,
        y: y - PAD_Y - SIZE,
        size: SIZE,
        font: fonts.heading,
        color: BLACK,
      });
    }
    drawLines(lines, tableX + NUM_W, y);
    y -= h;
  };

  const drawTable = (rows: TableRow[], gapAfter = 0) => {
    for (const row of rows) {
      if (row.kind === "heading") drawHeading(row.text);
      else if (row.kind === "spacer") y -= LINE_H;
      else drawItem(row);
    }
    y -= gapAfter;
  };

  drawHeader();

  drawTable(
    [
      { kind: "heading", text: "TOP 10 INTELLIGENCE" },
      ...payload.topItems.map((item, i) => ({ kind: "item" as const, n: i + 1, item, section: false })),
    ],
    8,
  );

  const sectionRows: TableRow[] = [];
  payload.sections.forEach((section, index) => {
    sectionRows.push({ kind: "heading", text: section.heading });
    const items = section.items.length ? section.items : [null];
    items.forEach((item, i) =>
      sectionRows.push({ kind: "item", n: item ? i + 1 : null, item, section: true }),
    );
    if (index < payload.sections.length - 1) sectionRows.push({ kind: "spacer" });
  });
  drawTable(sectionRows);

  return pdf.save();
}
