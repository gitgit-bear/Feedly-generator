import fs from "fs";
import path from "path";
import JSZip from "jszip";
import type { ReportItem, ReportPayload } from "./reportPayload";

const TEMPLATE = path.join(process.cwd(), "templates", "Feedly News Letter 2026-02-26_sample.docx");
const ROW_RE = /<w:tr\b[\s\S]*?<\/w:tr>/g;
const CELL_RE = /<w:tc\b[\s\S]*?<\/w:tc>/g;
const TEXT_RE = /<w:t([^>]*)>([^<]*)<\/w:t>/g;

function xmlEscape(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function run(text: string, color: string, italic = false): string {
  const i = italic ? "<w:i/><w:iCs/>" : "";
  return `<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:color w:val="${color}"/>${i}<w:kern w:val="0"/><w:sz w:val="26"/><w:szCs w:val="26"/><w:lang w:val="zh-TW"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function para(inner: string): string {
  return `<w:p><w:pPr><w:widowControl/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:adjustRightInd w:val="0"/><w:jc w:val="both"/></w:pPr>${inner}</w:p>`;
}

function br(): string {
  return `<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:br/></w:r>`;
}

function linkRun(url: string, rid: string): string {
  return `<w:hyperlink r:id="${rid}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:kern w:val="0"/><w:sz w:val="26"/><w:szCs w:val="26"/><w:lang w:val="zh-TW"/></w:rPr><w:t xml:space="preserve">${xmlEscape(url)}</w:t></w:r></w:hyperlink>`;
}

function articleParas(item: ReportItem | null, section: boolean, rid: string | null): string {
  if (!item || !rid) {
    return para(run("Nil", "4F4F4F", true));
  }
  let inner = run(item.title, "4F4F4F") + br();
  if (!section) inner += run(`${item.source} `, "12A2C6") + br();
  inner += linkRun(item.url, rid) + br();
  return para(inner);
}

function stripTableBorders(xml: string): string {
  const nil =
    "<w:tblBorders><w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/><w:right w:val=\"nil\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/></w:tblBorders>";
  const cellNil =
    "<w:tcBorders><w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/><w:right w:val=\"nil\"/></w:tcBorders>";
  xml = xml.replace(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/g, nil);
  xml = xml.replace(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/g, cellNil);
  xml = xml.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (_all, inner: string) => {
    if (inner.includes("<w:tblBorders")) return `<w:tblPr>${inner}</w:tblPr>`;
    return `<w:tblPr>${inner}${nil}</w:tblPr>`;
  });
  xml = xml.replace(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/g, (_all, inner: string) => {
    if (inner.includes("<w:tcBorders")) return `<w:tcPr>${inner}</w:tcPr>`;
    return `<w:tcPr>${inner}${cellNil}</w:tcPr>`;
  });
  return xml;
}

function setCellParagraphs(cell: string, paragraphs: string): string {
  return cell.replace(/(<w:tcPr>[\s\S]*?<\/w:tcPr>)[\s\S]*<\/w:tc>$/, `$1${paragraphs}</w:tc>`);
}

function setRowNumber(row: string, n: number): string {
  if (/<w:t>[0-9]+\.<\/w:t>/.test(row)) {
    return row.replace(/<w:t>[0-9]+\.<\/w:t>/, `<w:t>${n}.</w:t>`);
  }
  return row.replace(
    /(<w:tcPr>[\s\S]*?<\/w:tcPr><w:p[\s\S]*?<\/w:pPr>)(<\/w:p><\/w:tc>)/,
    `$1<w:r><w:rPr><w:rFonts w:ascii="MicrosoftYaHei" w:eastAsia="MicrosoftYaHei" w:hAnsi="MicrosoftYaHei" w:cs="MicrosoftYaHei"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t>${n}.</w:t></w:r>$2`,
  );
}

function rowPlainText(row: string): string {
  return [...row.matchAll(TEXT_RE)].map((m) => m[2]).join("").replace(/\s+/g, " ").trim();
}

function isAgencyHeading(row: string): boolean {
  return /intelligence from /i.test(rowPlainText(row));
}

function isAgencySlot(row: string): boolean {
  const cells = row.match(CELL_RE) ?? [];
  const leftCell = cells[0];
  const rightCell = cells[1];
  if (!leftCell || !rightCell || isAgencyHeading(row)) return false;
  const left = [...leftCell.matchAll(TEXT_RE)].map((m) => m[2]).join("").trim();
  const right = [...rightCell.matchAll(TEXT_RE)].map((m) => m[2]).join("").trim();
  if (!left && !right) return false;
  return true;
}

function setRowBody(row: string, paragraphs: string): string {
  const cells = row.match(CELL_RE);
  if (!cells || cells.length < 2) return row;
  const next = setCellParagraphs(cells[1], paragraphs);
  let seen = 0;
  return row.replace(CELL_RE, (cell) => {
    seen += 1;
    return seen === 2 ? next : cell;
  });
}

function replaceHeaderDate(xml: string, stamp: string): string {
  const matches = [...xml.matchAll(TEXT_RE)];
  if (!matches.length) return xml;
  const joined = matches.map((m) => m[2]).join("");
  const found = /\d{1,2}\s+[A-Za-z]+\s+\d{4}/.exec(joined);
  if (!found || found.index == null) return xml;
  let startCh = found.index;
  while (startCh > 0 && joined[startCh - 1] === " ") startCh -= 1;
  const endCh = found.index + found[0].length;
  let pos = 0;
  let startRun = 0;
  let endRun = matches.length - 1;
  for (let i = 0; i < matches.length; i += 1) {
    const next = pos + matches[i][2].length;
    if (pos <= startCh && next > startCh) startRun = i;
    if (pos < endCh && next >= endCh) endRun = i;
    pos = next;
  }
  let stampRun = startRun;
  for (let i = startRun; i <= endRun; i += 1) {
    if (/[A-Za-z]{3,}/.test(matches[i][2])) {
      stampRun = i;
      break;
    }
  }
  let out = xml;
  for (let i = endRun; i >= startRun; i -= 1) {
    const m = matches[i];
    if (m.index == null) continue;
    const replacement =
      i === stampRun
        ? `<w:t xml:space="preserve"> ${stamp.trim()}</w:t>`
        : `<w:t xml:space="preserve"></w:t>`;
    out = `${out.slice(0, m.index)}${replacement}${out.slice(m.index + m[0].length)}`;
  }
  return out;
}

function nextRelId(rels: string): number {
  const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return (ids.length ? Math.max(...ids) : 20) + 1;
}

function addHyperlink(rels: string, rid: string, url: string): string {
  const rel = `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(url)}" TargetMode="External"/>`;
  return rels.replace("</Relationships>", `${rel}</Relationships>`);
}

export async function fillSampleDocx(payload: ReportPayload): Promise<Uint8Array> {
  const bytes = fs.readFileSync(TEMPLATE);
  const zip = await JSZip.loadAsync(bytes);
  let document = await zip.file("word/document.xml")!.async("string");
  let rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  let header = await zip.file("word/header1.xml")!.async("string");

  header = replaceHeaderDate(header, payload.dateStamp);

  const rows = document.match(ROW_RE);
  if (!rows || rows.length < 12) {
    throw new Error("Sample template tables were not found");
  }

  let ridN = nextRelId(rels);
  const takeRid = (item: ReportItem | null): string | null => {
    if (!item) return null;
    const rid = `rId${ridN}`;
    ridN += 1;
    rels = addHyperlink(rels, rid, item.url);
    return rid;
  };

  for (let i = 0; i < 10; i += 1) {
    const item = payload.topItems[i] ?? null;
    const filled = setRowBody(rows[1 + i], articleParas(item, false, takeRid(item)));
    document = document.replace(rows[1 + i], filled);
    rows[1 + i] = filled;
  }

  const agencyHeadings = [
    "Intelligence from HKCERT",
    "Intelligence from GovCERT.HK",
    "Intelligence from Cybersechub",
  ];
  for (let s = 0; s < agencyHeadings.length; s += 1) {
    const headingIdx = rows.findIndex((row) => rowPlainText(row).includes(agencyHeadings[s]));
    if (headingIdx < 0) continue;
    const slots: number[] = [];
    for (let i = headingIdx + 1; i < rows.length; i += 1) {
      if (isAgencyHeading(rows[i])) break;
      if (isAgencySlot(rows[i])) slots.push(i);
      else if (slots.length) break;
    }
    if (!slots.length) continue;
    const items = payload.sections[s]?.items?.length ? payload.sections[s].items : [null];
    const proto = rows[slots[0]];
    const built = items.map((item, i) => {
      const row = setRowNumber(proto, i + 1);
      return setRowBody(row, articleParas(item, true, takeRid(item)));
    });
    const start = document.indexOf(rows[headingIdx]);
    const last = rows[slots[slots.length - 1]];
    const end = document.indexOf(last, start) + last.length;
    if (start < 0 || end < last.length) {
      throw new Error(`Sample template section was not found: ${agencyHeadings[s]}`);
    }
    document = `${document.slice(0, start)}${rows[headingIdx]}${built.join("")}${document.slice(end)}`;
  }

  document = stripTableBorders(document);

  zip.file("word/document.xml", document);
  zip.file("word/_rels/document.xml.rels", rels);
  zip.file("word/header1.xml", header);

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
