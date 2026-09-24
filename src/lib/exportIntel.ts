import type { AnalystRecord } from "./analystStore";
import type { IntelCluster } from "./intel";
import { computeRiskScore } from "./riskScore";
import { watchlistMatches } from "./intel";

export function clustersToCsv(clusters: IntelCluster[], watchlist: string[]): string {
  const header = [
    "id",
    "title",
    "severity",
    "risk",
    "cves",
    "cvss",
    "epss",
    "kev",
    "exploited",
    "vendor",
    "products",
    "sources",
    "lastSeen",
    "watchlist",
    "url",
  ];
  const rows = clusters.map((cluster) => {
    const hits = watchlistMatches(cluster, watchlist);
    const risk = computeRiskScore(cluster, hits).score;
    const cells = [
      cluster.id,
      cluster.title,
      cluster.severity,
      String(risk),
      cluster.cves.join(" "),
      cluster.cvss ?? "",
      cluster.epss != null ? (cluster.epss * 100).toFixed(2) : "",
      cluster.kev ? "yes" : "no",
      cluster.exploited ? "yes" : "no",
      cluster.vendor ?? "",
      cluster.products.join("; "),
      cluster.sources.join("; "),
      cluster.lastSeen,
      hits.join("; "),
      cluster.articles[0]?.url ?? "",
    ];
    return cells.map(csvEscape).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

export function clustersToJson(
  clusters: IntelCluster[],
  watchlist: string[],
  analystMap: Record<string, AnalystRecord>,
): string {
  const payload = clusters.map((cluster) => {
    const hits = watchlistMatches(cluster, watchlist);
    return {
      id: cluster.id,
      title: cluster.title,
      summary: cluster.summary,
      severity: cluster.severity,
      risk: computeRiskScore(cluster, hits),
      cves: cluster.cves,
      cvss: cluster.cvss ?? null,
      epss: cluster.epss ?? null,
      kev: cluster.kev,
      exploited: cluster.exploited,
      vendor: cluster.vendor ?? null,
      products: cluster.products,
      sources: cluster.sources,
      lastSeen: cluster.lastSeen,
      firstSeen: cluster.firstSeen,
      watchlistMatches: hits,
      analyst: analystMap[cluster.id] ?? null,
      urls: cluster.articles.map((a) => ({ source: a.source, url: a.url, title: a.title })),
    };
  });
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: payload.length, items: payload }, null, 2);
}

function csvEscape(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadText(filename: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
