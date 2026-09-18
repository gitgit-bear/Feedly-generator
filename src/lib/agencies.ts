import type { AgencyItem } from "./types";
import { isReportToday } from "./rank";

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

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function utcCalendarIso(day: number, monthName: string, year: number): string | null {
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (month == null || !day || !year) return null;
  const ms = Date.UTC(year, month, day);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function parseLooseDate(raw: string): string | null {
  const t = raw.trim();
  const dmyText = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (dmyText) return utcCalendarIso(Number(dmyText[1]), dmyText[2], Number(dmyText[3]));
  const dmyDash = t.match(/^(\d{2})-([A-Za-z]+)-(\d{4})$/);
  if (dmyDash) return utcCalendarIso(Number(dmyDash[1]), dmyDash[2], Number(dmyDash[3]));
  const ymd = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const ms = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  const tries = [t, t.replace("Z", "+00:00")];
  for (const x of tries) {
    const d = new Date(x);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function reportDayOnly(items: AgencyItem[]): AgencyItem[] {
  return items.filter((x) => isReportToday(x.pubDate));
}

function hkcertBulletinDate(card: string): string | null {
  const released = card.match(/Release\s*Date\s*:\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})/i);
  return released?.[1] ? parseLooseDate(released[1]) : null;
}

export async function fetchHkcert(): Promise<AgencyItem[]> {
  const base = "https://www.hkcert.org/security-bulletin";
  const html = await getText(base, 15000);
  const out: AgencyItem[] = [];
  const cardRe =
    /<a[^>]*class="[^"]*listingcard__item[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html))) {
    const hrefRaw = m[1];
    const card = m[2];
    if (!hrefRaw || !/\/security-bulletin\/[^/?#]+/i.test(hrefRaw)) continue;
    const titleM = card.match(/listingcard__title[^>]*>([\s\S]*?)<\/(?:p|div|h[1-6])>/i);
    const title = strip(titleM?.[1] ?? "").replace(/\s+(NEW|UPDATE)$/i, "");
    if (!title) continue;
    out.push({
      title,
      url: new URL(hrefRaw, base).toString(),
      source: "HKCERT",
      pubDate: hkcertBulletinDate(card),
    });
  }
  return reportDayOnly(out);
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
  return reportDayOnly(out);
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
      if (pubDate && !isReportToday(pubDate)) {
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
  return reportDayOnly(out);
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
