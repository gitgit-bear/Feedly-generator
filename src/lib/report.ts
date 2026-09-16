import type { ReportItem, ReportPayload } from "./reportPayload";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function block(item: ReportItem | null, extra = false): string {
  if (!item) return `<p class="nil">Nil</p>`;
  const title = esc(item.title);
  const url = esc(item.url);
  const source = esc(item.source);
  return `<div class="item">
    <p class="title">${title}</p>
    ${extra ? "" : `<p class="source">${source}</p>`}
    <p class="url"><a href="${url}">${url}</a></p>
  </div>`;
}

export function renderReportHtml(payload: ReportPayload): string {
  const topRows = payload.topItems
    .map((item, i) => `<tr><td class="num">${i + 1}.</td><td>${block(item)}</td></tr>`)
    .join("");

  const section = (heading: string, items: ReportItem[]) => {
    if (!items.length) {
      return `<tr><td colspan="2" class="head">${esc(heading)}</td></tr>
        <tr><td class="num">1.</td><td>${block(null, true)}</td></tr>`;
    }
    return (
      `<tr><td colspan="2" class="head">${esc(heading)}</td></tr>` +
      items.map((it, i) => `<tr><td class="num">${i + 1}.</td><td>${block(it, true)}</td></tr>`).join("")
    );
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(payload.basename)}</title>
  <style>
    body { font-family: Cambria, Georgia, serif; color: #4f4f4f; margin: 32px; }
    h1 { font-family: "Microsoft YaHei", sans-serif; font-size: 18px; color: #111; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; padding: 8px 6px; }
    .num { width: 36px; font-weight: bold; }
    .head { font-family: "Microsoft YaHei", sans-serif; font-weight: bold; padding-top: 18px; }
    .title { margin: 0 0 4px; }
    .source { margin: 0 0 4px; color: #12a2c6; }
    .url a { color: #00c; }
    .nil { font-style: italic; margin: 0; }
  </style>
</head>
<body>
  <p>${esc(payload.dateStamp)}</p>
  <h1>TOP 10 INTELLIGENCE</h1>
  <table>${topRows}</table>
  <table>
    ${payload.sections.map((sec) => section(sec.heading, sec.items)).join("")}
  </table>
</body>
</html>`;
}
