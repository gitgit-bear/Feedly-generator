import type { AgencyItem, Article } from "./types";
import { top10 } from "./rank";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function block(item: AgencyItem | Article | null, extra = false): string {
  if (!item) return `<p class="nil">Nil</p>`;
  const title = esc(item.title);
  const url = esc(item.url);
  const source = "source" in item ? esc(item.source) : "";
  return `<div class="item">
    <p class="title">${title}</p>
    ${extra ? "" : `<p class="source">${source}</p>`}
    <p class="url"><a href="${url}">${url}</a></p>
  </div>`;
}

export function renderReportHtml(articles: Article[], agencies: {
  hkcert: AgencyItem[];
  govcert: AgencyItem[];
  cybersechub: AgencyItem[];
}): string {
  const tops = top10(articles);
  const stamp = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const topRows = Array.from({ length: 10 }, (_, i) => {
    const item = tops[i] ?? null;
    return `<tr><td class="num">${i + 1}.</td><td>${block(item)}</td></tr>`;
  }).join("");

  const section = (heading: string, items: AgencyItem[]) => {
    if (!items.length) {
      return `<tr><td colspan="2" class="head">${esc(heading)}</td></tr>
        <tr><td class="num">1.</td><td>${block(null, true)}</td></tr>`;
    }
    return `<tr><td colspan="2" class="head">${esc(heading)}</td></tr>` +
      items
        .map((it, i) => `<tr><td class="num">${i + 1}.</td><td>${block(it, true)}</td></tr>`)
        .join("");
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Feedly News Letter ${stamp}</title>
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
  <p>${esc(stamp)}</p>
  <h1>TOP 10 INTELLIGENCE</h1>
  <table>${topRows}</table>
  <table>
    ${section("Intelligence from HKCERT", agencies.hkcert)}
    ${section("Intelligence from GovCERT.HK", agencies.govcert)}
    ${section("Intelligence from Cybersechub", agencies.cybersechub)}
  </table>
</body>
</html>`;
}
