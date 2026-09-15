import fs from "fs";
import path from "path";
import { PDFDocument, PDFFont, PDFImage, RGB, StandardFonts, rgb } from "pdf-lib";
import type { ReportItem, ReportPayload } from "./reportPayload";

const TITLE = rgb(79 / 255, 79 / 255, 79 / 255);
const SOURCE = rgb(18 / 255, 162 / 255, 198 / 255);
const LINK = rgb(0, 0, 1);
const BLACK = rgb(0.1, 0.1, 0.1);
const DATE = rgb(51 / 255, 204 / 255, 51 / 255);

type Fonts = {
  body: PDFFont;
  heading: PDFFont;
  italic: PDFFont;
};

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

function loadHeaderPng(): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), "templates", "feedly_header.png"));
  } catch {
    return null;
  }
}

export async function buildReportPdf(payload: ReportPayload): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    body: await pdf.embedFont(StandardFonts.TimesRoman),
    heading: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
  };
  let banner: PDFImage | null = null;
  const png = loadHeaderPng();
  if (png) {
    try {
      banner = await pdf.embedPng(png);
    } catch {
      banner = null;
    }
  }

  const pageSize: [number, number] = [595.3, 841.9];
  const margin = { top: 49.6, bottom: 35.4, left: 28.35, right: 28.35 };
  const size = 13;
  const lineH = 16;
  let page = pdf.addPage(pageSize);
  let y = page.getHeight() - margin.top;

  const ensure = (need: number) => {
    if (y - need < margin.bottom) {
      page = pdf.addPage(pageSize);
      y = page.getHeight() - margin.top;
    }
  };

  const drawLines = (lines: string[], font: PDFFont, color: RGB, x: number, underline = false) => {
    for (const line of lines) {
      ensure(lineH);
      page.drawText(line, { x, y: y - size, size, font, color });
      if (underline) {
        const w = font.widthOfTextAtSize(line, size);
        page.drawLine({
          start: { x, y: y - size - 1 },
          end: { x: x + w, y: y - size - 1 },
          thickness: 0.6,
          color,
        });
      }
      y -= lineH;
    }
  };

  if (banner) {
    const width = 545;
    const height = (banner.height / banner.width) * width;
    page.drawImage(banner, {
      x: margin.left,
      y: y - height,
      width,
      height,
    });
    const date = ` ${payload.dateStamp}`;
    const dateSize = 12;
    page.drawText(date, {
      x: page.getWidth() - margin.right - fonts.heading.widthOfTextAtSize(date, dateSize) - 8,
      y: y - 28,
      size: dateSize,
      font: fonts.heading,
      color: DATE,
    });
    y -= height + 10;
  } else {
    page.drawText(payload.dateStamp, {
      x: page.getWidth() - margin.right - fonts.body.widthOfTextAtSize(payload.dateStamp, 12),
      y: y - 12,
      size: 12,
      font: fonts.body,
      color: DATE,
    });
    y -= 28;
  }

  const contentX = margin.left + 34;
  const maxW = page.getWidth() - contentX - margin.right;

  const drawItem = (n: number, item: ReportItem | null, section: boolean) => {
    ensure(lineH * 4);
    page.drawText(`${n}.`, { x: margin.left, y: y - size, size, font: fonts.heading, color: BLACK });
    if (!item) {
      page.drawText("Nil", { x: contentX, y: y - size, size, font: fonts.italic, color: TITLE });
      y -= lineH * 2;
      return;
    }
    drawLines(wrap(item.title, fonts.body, size, maxW), fonts.body, TITLE, contentX);
    if (!section) {
      drawLines(wrap(`${item.source} `, fonts.body, size, maxW), fonts.body, SOURCE, contentX);
    }
    drawLines(wrap(item.url, fonts.body, size, maxW), fonts.body, LINK, contentX, true);
    y -= 6;
  };

  page.drawText("TOP 10 INTELLIGENCE", { x: margin.left, y: y - size, size, font: fonts.heading, color: BLACK });
  y -= lineH * 1.4;
  payload.topItems.forEach((item, i) => drawItem(i + 1, item, false));

  for (const section of payload.sections) {
    y -= 8;
    ensure(lineH * 3);
    page.drawText(section.heading, { x: margin.left, y: y - size, size, font: fonts.heading, color: BLACK });
    y -= lineH * 1.4;
    const items = section.items.length ? section.items : [null];
    items.forEach((item, i) => drawItem(i + 1, item, true));
  }

  return pdf.save();
}
