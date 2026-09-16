import type { AgencyItem } from "./types";
import { isToday } from "./rank";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 CyberGuardWeb/1.0";

async function getText(url: string, timeoutMs = 5000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate: 120 },
  });
  if (!res.ok) return "";
  return res.text();
}

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLooseDate(raw: string): string | null {
  const t = raw.trim();
  const tries = [t, t.replace("Z", "+00:00")];
  for (const x of tries) {
    const d = new Date(x);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const m = t.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const d = new Date(`${m[2]} ${m[1]}, ${m[3]} UTC`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const dmy = t.match(/(\d{2})-([A-Za-z]+)-(\d{4})/);
  if (dmy) {
    const d = new Date(`${dmy[2]} ${dmy[1]}, ${dmy[3]} UTC`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function todayOnly(items: AgencyItem[]): AgencyItem[] {
  return items.filter((x) => isToday(x.pubDate));
}

export async function fetchHkcert(): Promise<AgencyItem[]> {
  const base = "https://www.hkcert.org/security-bulletin";
  const html = await getText(base);
  const out: AgencyItem[] = [];
  const cardRe = /<div[^>]*class="[^"]*listingcard__item[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi;
  let m: RegExpExecArray | null;
  const cards = html.match(cardRe) ?? [];
  for (const card of cards.length ? cards : []) {
    const titleM = card.match(/listingcard__title[^>]*>([\s\S]*?)<\/(?:p|div|h[1-6])>/i);
    const hrefM = card.match(/href="([^"]+)"/i);
    const dateM = card.match(/Release\s*Date\s*:\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})/i);
    const title = strip(titleM?.[1] ?? "").replace(/\s+NEW$/i, "");
    if (!title) continue;
    const href = hrefM?.[1] ? new URL(hrefM[1], base).toString() : base;
    out.push({ title, url: href, source: "HKCERT", pubDate: dateM ? parseLooseDate(dateM[1]) : null });
  }
  return todayOnly(out);
}

export async function fetchGovcert(): Promise<AgencyItem[]> {
  const base = "https://www.govcert.gov.hk/en/alerts.php";
  const html = await getText(base);
  const out: AgencyItem[] = [];
  const rowRe =
    /(\d{2}-[A-Za-z]+-\d{4})[\s\S]{0,200}?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const title = strip(m[3]);
    if (!title) continue;
    out.push({
      title,
      url: new URL(m[2], base).toString(),
      source: "GovCERT.HK",
      pubDate: parseLooseDate(m[1]),
    });
  }
  return todayOnly(out);
}

export async function fetchCybersechub(): Promise<AgencyItem[]> {
  const out: AgencyItem[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let page = 0; page < 1 && out.length < 20; page += 1) {
    const res = await fetch("https://www.cybersechub.hk/backend_api/getCVEAlerts", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: "https://www.cybersechub.hk",
        Referer: "https://www.cybersechub.hk/en/alerts",
      },
      body: JSON.stringify({
        type: 0,
        keywords: "",
        offset,
        sortBy: 2,
        fromDate: "",
        toDate: "",
        timeOffset: -480,
      }),
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 120 },
    });
    if (!res.ok) break;
    const data = (await res.json()) as { combineList?: unknown[] };
    const rows = Array.isArray(data.combineList) ? data.combineList : [];
    if (!rows.length) break;
    let older = false;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const cveId = String(rec.CVE_ID || rec.cveId || rec.cve_id || "").trim();
      const desc = String(rec.description || rec.title || rec.name || "").replace(/\s+/g, " ").trim();
      const title = cveId && desc ? `${cveId}: ${desc}` : cveId || desc;
      const dateRaw = String(rec.publishTime || rec.updateTime || rec.publishDate || rec.date || rec.createdAt || "");
      if (!title) continue;
      const pubDate = parseLooseDate(dateRaw);
      if (pubDate && !isToday(pubDate)) {
        older = true;
        continue;
      }
      const key = (cveId || title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const up = (cveId || title).toUpperCase();
      const url = up.startsWith("CVE-")
        ? `https://nvd.nist.gov/vuln/detail/${cveId || title}`
        : up.startsWith("CNVD-")
          ? `https://www.cnvd.org.cn/flaw/show/${cveId || title}`
          : "https://www.cybersechub.hk/en/alerts";
      out.push({ title, url, source: "Cybersechub", pubDate });
    }
    if (older) break;
    offset += rows.length;
  }
  return todayOnly(out);
}

export async function fetchAgencies(): Promise<{
  hkcert: AgencyItem[];
  govcert: AgencyItem[];
  cybersechub: AgencyItem[];
}> {
  const [hkcert, govcert, cybersechub] = await Promise.all([
    fetchHkcert().catch(() => [] as AgencyItem[]),
    fetchGovcert().catch(() => [] as AgencyItem[]),
    fetchCybersechub().catch(() => [] as AgencyItem[]),
  ]);
  return { hkcert, govcert, cybersechub };
}
