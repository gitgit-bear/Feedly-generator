import { extractCves } from "./intel";
import type { Article } from "./types";

export type CveEnrichment = {
  cve: string;
  cvss?: number;
  epss?: number;
  epssPercentile?: number;
  kev: boolean;
  kevDateAdded?: string;
  vendor?: string;
  product?: string;
  sources: Array<"cisa" | "first" | "nvd" | "text">;
};

type KevCatalog = {
  vulnerabilities?: Array<{
    cveID: string;
    dateAdded?: string;
    vendorProject?: string;
    product?: string;
  }>;
};

let kevCache: { at: number; map: Map<string, CveEnrichment> } | null = null;
const KEV_TTL_MS = 6 * 60 * 60 * 1000;

async function loadKevMap(): Promise<Map<string, CveEnrichment>> {
  if (kevCache && Date.now() - kevCache.at < KEV_TTL_MS) return kevCache.map;
  const map = new Map<string, CveEnrichment>();
  try {
    const res = await fetch("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", {
      headers: { Accept: "application/json", "User-Agent": "CyberGuardIntelligence/1.0" },
      next: { revalidate: 21600 },
    } as RequestInit);
    if (res.ok) {
      const json = (await res.json()) as KevCatalog;
      for (const row of json.vulnerabilities ?? []) {
        const cve = row.cveID?.toUpperCase();
        if (!cve) continue;
        map.set(cve, {
          cve,
          kev: true,
          kevDateAdded: row.dateAdded,
          vendor: row.vendorProject,
          product: row.product,
          sources: ["cisa"],
        });
      }
    }
  } catch {
    /* keep empty — never invent KEV */
  }
  kevCache = { at: Date.now(), map };
  return map;
}

async function fetchEpss(cves: string[]): Promise<Map<string, { epss: number; percentile?: number }>> {
  const out = new Map<string, { epss: number; percentile?: number }>();
  const unique = [...new Set(cves.map((c) => c.toUpperCase()))].slice(0, 80);
  if (!unique.length) return out;
  // FIRST allows comma-separated CVE list
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    try {
      const url = `https://api.first.org/data/v1/epss?cve=${chunk.map(encodeURIComponent).join(",")}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "CyberGuardIntelligence/1.0" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: Array<{ cve: string; epss: string; percentile?: string }>;
      };
      for (const row of json.data ?? []) {
        const epss = Number(row.epss);
        const percentile = row.percentile != null ? Number(row.percentile) : undefined;
        if (!Number.isFinite(epss)) continue;
        out.set(row.cve.toUpperCase(), {
          epss,
          percentile: Number.isFinite(percentile) ? percentile : undefined,
        });
      }
    } catch {
      /* skip chunk */
    }
  }
  return out;
}

async function fetchNvdCvss(cves: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const key = process.env.NVD_API_KEY?.trim();
  const unique = [...new Set(cves.map((c) => c.toUpperCase()))].slice(0, 30);
  for (const cve of unique) {
    try {
      const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cve)}`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "CyberGuardIntelligence/1.0",
          ...(key ? { apiKey: key } : {}),
        },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        vulnerabilities?: Array<{
          cve?: {
            metrics?: {
              cvssMetricV31?: Array<{ cvssData?: { baseScore?: number } }>;
              cvssMetricV30?: Array<{ cvssData?: { baseScore?: number } }>;
              cvssMetricV2?: Array<{ cvssData?: { baseScore?: number } }>;
            };
          };
        }>;
      };
      const metrics = json.vulnerabilities?.[0]?.cve?.metrics;
      const score =
        metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore ??
        metrics?.cvssMetricV30?.[0]?.cvssData?.baseScore ??
        metrics?.cvssMetricV2?.[0]?.cvssData?.baseScore;
      if (typeof score === "number" && Number.isFinite(score)) out.set(cve, score);
      await new Promise((r) => setTimeout(r, key ? 100 : 700));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function collectArticleCves(articles: Article[]): string[] {
  const set = new Set<string>();
  for (const article of articles) {
    for (const cve of extractCves(`${article.title} ${article.description}`)) set.add(cve);
  }
  return [...set];
}

/** Enrich CVEs from CISA KEV + FIRST EPSS (+ optional NVD). Never invents values. */
export async function enrichCves(cves: string[]): Promise<Record<string, CveEnrichment>> {
  const unique = [...new Set(cves.map((c) => c.toUpperCase()))];
  if (!unique.length) return {};
  const [kevMap, epssMap, nvdMap] = await Promise.all([
    loadKevMap(),
    fetchEpss(unique),
    fetchNvdCvss(unique),
  ]);
  const out: Record<string, CveEnrichment> = {};
  for (const cve of unique) {
    const kev = kevMap.get(cve);
    const epss = epssMap.get(cve);
    const cvss = nvdMap.get(cve);
    if (!kev && !epss && cvss == null) continue;
    const sources: CveEnrichment["sources"] = [];
    if (kev) sources.push("cisa");
    if (epss) sources.push("first");
    if (cvss != null) sources.push("nvd");
    out[cve] = {
      cve,
      kev: Boolean(kev?.kev),
      kevDateAdded: kev?.kevDateAdded,
      vendor: kev?.vendor,
      product: kev?.product,
      epss: epss?.epss,
      epssPercentile: epss?.percentile,
      cvss,
      sources,
    };
  }
  return out;
}
