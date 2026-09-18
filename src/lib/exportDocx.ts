import fs from "fs";
import path from "path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Header,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { ReportItem, ReportPayload } from "./reportPayload";

const LINE = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const CELL_BORDERS = {
  top: LINE,
  bottom: LINE,
  left: LINE,
  right: LINE,
};
const TITLE = "4F4F4F";
const SOURCE = "12A2C6";
const LINK = "0000FF";
const DATE = "33CC33";
const NUM_W = 676;
const BODY_W = 10232;
const TABLE_W = 10908;

function headerImage(): ImageRun | null {
  const file = path.join(process.cwd(), "templates", "feedly_header.png");
  try {
    const data = fs.readFileSync(file);
    return new ImageRun({
      type: "png",
      data,
      transformation: { width: 727, height: 64 },
    });
  } catch {
    return null;
  }
}

function lineBreak(): TextRun {
  return new TextRun({ break: 1 });
}

function nilRuns(): TextRun[] {
  return [new TextRun({ text: "Nil", italics: true, font: "Cambria", size: 26, color: TITLE })];
}

function articleRuns(item: ReportItem, section: boolean): Array<TextRun | ExternalHyperlink> {
  const runs: Array<TextRun | ExternalHyperlink> = [
    new TextRun({ text: item.title, font: "Cambria", size: 26, color: TITLE }),
    lineBreak(),
  ];
  if (!section) {
    runs.push(new TextRun({ text: `${item.source} `, font: "Cambria", size: 26, color: SOURCE }), lineBreak());
  }
  runs.push(
    new ExternalHyperlink({
      link: item.url,
      children: [
        new TextRun({
          text: item.url,
          font: "Cambria",
          size: 26,
          color: LINK,
          underline: {},
        }),
      ],
    }),
    lineBreak(),
  );
  return runs;
}

function numCell(text: string): TableCell {
  return new TableCell({
    borders: CELL_BORDERS,
    width: { size: NUM_W, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 108, right: 108 },
    verticalAlign: VerticalAlign.TOP,
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0, line: 240 },
        keepLines: true,
        children: [new TextRun({ text, font: "Microsoft YaHei", size: 26 })],
      }),
    ],
  });
}

function contentCell(children: Array<TextRun | ExternalHyperlink>): TableCell {
  return new TableCell({
    borders: CELL_BORDERS,
    width: { size: BODY_W, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 108, right: 108 },
    verticalAlign: VerticalAlign.TOP,
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0, line: 240 },
        keepLines: true,
        children,
      }),
    ],
  });
}

function headingRow(text: string): TableRow {
  return new TableRow({
    cantSplit: true,
    children: [
      new TableCell({
        borders: CELL_BORDERS,
        columnSpan: 2,
        width: { size: TABLE_W, type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 108, right: 108 },
        children: [
          new Paragraph({
            spacing: { before: 0, after: 0, line: 240 },
            keepLines: true,
            keepNext: true,
            children: [new TextRun({ text, font: "Microsoft YaHei", size: 26 })],
          }),
        ],
      }),
    ],
  });
}

function itemRow(n: number | null, item: ReportItem | null, section: boolean): TableRow {
  return new TableRow({
    cantSplit: true,
    children: [numCell(n == null ? "" : `${n}.`), contentCell(item ? articleRuns(item, section) : nilRuns())],
  });
}

export async function buildReportDocx(payload: ReportPayload): Promise<Uint8Array> {
  const banner = headerImage();
  const topRows = [
    headingRow("TOP 10 INTELLIGENCE"),
    ...payload.topItems.map((item, i) => itemRow(i + 1, item, false)),
  ];
  const sectionRows: TableRow[] = [];
  for (const section of payload.sections) {
    sectionRows.push(headingRow(section.heading));
    const items = section.items.length ? section.items : [null];
    items.forEach((item, i) => sectionRows.push(itemRow(item ? i + 1 : null, item, true)));
  }

  const headerChildren: Paragraph[] = [];
  if (banner) {
    headerChildren.push(new Paragraph({ children: [banner] }));
  }
  headerChildren.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: ` ${payload.dateStamp}`,
          font: "Microsoft YaHei",
          size: 24,
          color: DATE,
        }),
      ],
    }),
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 992, bottom: 709, left: 567, right: 567, header: 567, footer: 992 },
          },
        },
        headers: {
          default: new Header({ children: headerChildren }),
        },
        children: [
          new Table({
            width: { size: TABLE_W, type: WidthType.DXA },
            borders: {
              top: LINE,
              bottom: LINE,
              left: LINE,
              right: LINE,
              insideHorizontal: LINE,
              insideVertical: LINE,
            },
            columnWidths: [NUM_W, BODY_W],
            rows: topRows,
          }),
          new Paragraph({ spacing: { after: 200 }, children: [] }),
          new Table({
            width: { size: TABLE_W, type: WidthType.DXA },
            borders: {
              top: LINE,
              bottom: LINE,
              left: LINE,
              right: LINE,
              insideHorizontal: LINE,
              insideVertical: LINE,
            },
            columnWidths: [NUM_W, BODY_W],
            rows: sectionRows,
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
