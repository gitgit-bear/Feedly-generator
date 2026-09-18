import fs from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFImage, StandardFonts, rgb } from "pdf-lib";
import { addUriLink } from "./pdfLinks";
import type { BriefLevel, WeeklyBrief } from "./weeklyBrief";

const PAGE: [number, number] = [595.3, 841.9];
const MARGIN = { top: 49.65, bottom: 35.45, left: 28.35, right: 28.3 };
const HEADER_DIST = 28.35;
const HEADER_W = 545;
const HEADER_H = 47.7;
const INK = rgb(79 / 255, 79 / 255, 79 / 255);
const BLACK = rgb(0, 0, 0);
const LINK = rgb(0, 0, 1);
const MUTED = rgb(90 / 255, 90 / 255, 90 / 255);
const RED = rgb(0.75, 0.12, 0.12);
const AMBER = rgb(0.72, 0.45, 0.05);
const GREEN = rgb(0.12, 0.48, 0.28);

type Fonts = { body: PDFFont; heading: PDFFont; italic: PDFFont };

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
  const heading = await pdf.embedFont(StandardFonts.HelveticaBold);
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
      /* bundled TTF failed */
    }
  }
  return {
    body: await pdf.embedFont(StandardFonts.TimesRoman),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    heading,
  };
}

function levelColor(level: BriefLevel) {
  if (level === "red") return RED;
  if (level === "amber") return AMBER;
  return GREEN;
}

function levelLabel(level: BriefLevel) {
  if (level === "red") return "RED — ACTION";
  if (level === "amber") return "AMBER — DECIDE";
  return "GREEN — AWARENESS";
}

export async function buildWeeklyBriefPdf(brief: WeeklyBrief): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts = await embedFonts(pdf);
  const banner = await embedHeader(pdf);
  const page = pdf.addPage(PAGE);
  const width = page.getWidth();
  let y = page.getHeight() - MARGIN.top;
  const x = MARGIN.left;
  const maxW = width - MARGIN.left - MARGIN.right;
  const SIZE = 11;
  const LINE = 14;

  if (banner) {
    const top = page.getHeight() - HEADER_DIST;
    page.drawImage(banner, {
      x,
      y: top - HEADER_H,
      width: HEADER_W,
      height: HEADER_H,
    });
    y = top - HEADER_H - 16;
  }

  page.drawText("WEEKLY MANAGEMENT BRIEF", {
    x,
    y,
    size: 14,
    font: fonts.heading,
    color: BLACK,
  });
  y -= 18;
  page.drawText(latin(brief.weekLabel), {
    x,
    y,
    size: 11,
    font: fonts.body,
    color: MUTED,
  });
  const badge = levelLabel(brief.overall);
  const badgeW = fonts.heading.widthOfTextAtSize(badge, 10);
  page.drawText(badge, {
    x: x + maxW - badgeW,
    y,
    size: 10,
    font: fonts.heading,
    color: levelColor(brief.overall),
  });
  y -= 20;

  page.drawCircle({
    x: x + 5,
    y: y + 3,
    size: 5,
    color: levelColor(brief.overall),
  });
  let summaryY = y;
  for (const line of wrap(brief.summary, fonts.body, 12, maxW - 16)) {
    page.drawText(line, { x: x + 16, y: summaryY, size: 12, font: fonts.body, color: INK });
    summaryY -= 15;
  }
  y = summaryY - 6;

  brief.topics.forEach((topic, i) => {
    y -= 8;
    page.drawText(`${i + 1}.  ${latin(topic.asset).toUpperCase()}`, {
      x,
      y,
      size: 10,
      font: fonts.heading,
      color: BLACK,
    });
    const tag = topic.level.toUpperCase();
    const tagW = fonts.heading.widthOfTextAtSize(tag, 9);
    page.drawText(tag, {
      x: x + maxW - tagW,
      y,
      size: 9,
      font: fonts.heading,
      color: levelColor(topic.level),
    });
    y -= 16;

    for (const line of wrap(topic.title, fonts.body, 12, maxW)) {
      page.drawText(line, { x, y, size: 12, font: fonts.body, color: INK });
      y -= LINE;
    }

    const blocks: Array<{ label: string; text: string }> = [
      { label: "Why", text: topic.why },
      { label: "Ask", text: topic.ask },
    ];
    for (const block of blocks) {
      const label = `${block.label}: `;
      const labelW = fonts.heading.widthOfTextAtSize(label, SIZE);
      const lines = wrap(block.text, fonts.body, SIZE, maxW - labelW);
      page.drawText(label, { x, y, size: SIZE, font: fonts.heading, color: BLACK });
      page.drawText(lines[0] ?? "", { x: x + labelW, y, size: SIZE, font: fonts.body, color: INK });
      y -= LINE;
      for (const line of lines.slice(1)) {
        page.drawText(line, { x: x + labelW, y, size: SIZE, font: fonts.body, color: INK });
        y -= LINE;
      }
    }

    if (topic.url) {
      const src = topic.related > 1 ? `${topic.source}  ·  ${topic.related} related stories` : topic.source;
      const srcLines = wrap(src, fonts.italic, 9, maxW);
      for (const line of srcLines) {
        page.drawText(line, { x, y, size: 9, font: fonts.italic, color: LINK });
        addUriLink(page, x, y - 2, Math.min(maxW, fonts.italic.widthOfTextAtSize(line, 9)), 11, topic.url);
        y -= 12;
      }
    }
    y -= 4;
  });

  const foot = `Scanned ${brief.scanned} unique stories in the last 7 days (HK). Not a substitute for internal asset confirmation.`;
  page.drawText(latin(foot), {
    x,
    y: MARGIN.bottom,
    size: 8,
    font: fonts.italic,
    color: MUTED,
  });

  return pdf.save();
}
