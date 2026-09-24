import { isToday, sameStory, titleTokens } from "./rank";
import type { Article } from "./types";

export type Severity = "critical" | "high" | "medium" | "low" | "unknown";
export type AnalystStatus = "new" | "reviewing" | "action" | "monitoring" | "closed";
export type RegionFilter = "" | "global" | "apac" | "hk";
export type TimeFilter = "" | "1h" | "6h" | "24h" | "7d" | "30d" | "today";
export type TopicFilter = "" | "breaches" | "vulns" | "malware" | "phishing" | "apt" | "patch";
export type IocType = "ipv4" | "ipv6" | "domain" | "url" | "sha256" | "sha1" | "md5" | "email" | "filename";
export type SortMode = "risk" | "epss" | "cvss" | "recent" | "watchlist";
export type MetricId = "critical" | "kev" | "epss" | "watchlist" | "newCve" | "exploited";

export type IOC = { type: IocType; value: string };
export type MitreRef = { tactic?: string; technique: string; name?: string };

export type IntelFilters = {
  time: TimeFilter;
  severities: Severity[];
  kev: "" | "yes" | "no";
  epssHigh: boolean;
  epssMin: number | null;
  vendor: string;
  product: string;
  source: string;
  region: RegionFilter;
  topic: TopicFilter;
  watchlistOnly: boolean;
  unreadOnly: boolean;
  savedOnly: boolean;
  exploitedOnly: boolean;
};

export const DEFAULT_TIME: TimeFilter = "24h";

export const EMPTY_FILTERS: IntelFilters = {
  time: DEFAULT_TIME,
  severities: [],
  kev: "",
  epssHigh: false,
  epssMin: null,
  vendor: "",
  product: "",
  source: "",
  region: "",
  topic: "",
  watchlistOnly: false,
  unreadOnly: false,
  savedOnly: false,
  exploitedOnly: false,
};

export type IntelCluster = {
  id: string;
  title: string;
  summary: string;
  articles: Article[];
  cves: string[];
  vendor?: string;
  products: string[];
  severity: Severity;
  cvss?: number;
  epss?: number;
  epssPercentile?: number;
  kev: boolean;
  kevMentioned: boolean;
  exploitPublic: boolean;
  exploited: boolean;
  firstSeen: string;
  lastSeen: string;
  sources: string[];
  iocs: IOC[];
  mitre: MitreRef[];
  hkReasons: string[];
  apac: boolean;
  unread: boolean;
};

const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi;
const CVSS_RE = /\bcvss(?:\s*v?\d(?:\.\d)?)?[^0-9]{0,12}([0-9]{1,2}(?:\.\d)?)\b/i;
const EPSS_RE = /\bepss[^0-9%]{0,16}([0-9]*\.?[0-9]+)\s*(%|percentile)?/i;
const EPSS_PCT_RE = /\bepss[^0-9%]{0,24}percentile[^0-9]{0,8}([0-9]*\.?[0-9]+)\s*%?/i;
const KEV_RE = /\bcisa\s*kev\b|\bkev catalog\b|known exploited vulnerabilit|added to (?:the )?kev|\bknown exploited\b/i;
const EXPLOIT_PUBLIC_RE = /public (?:poc|exploit)|poc (?:available|published|released)|exploit(?:ation)? code available|proof[- ]of[- ]concept/i;
const EXPLOITED_RE = /actively exploited|exploited in the wild|in[- ]the[- ]wild exploit|zero[- ]day exploited/i;
const MITRE_RE = /\bT\d{4}(?:\.\d{3})?\b/g;

const VENDORS: Array<{ id: string; label: string; re: RegExp; products?: Array<{ label: string; re: RegExp }> }> = [
  { id: "fortinet", label: "Fortinet", re: /\bfortinet\b|\bfortigate\b|\bfortios\b/, products: [{ label: "FortiOS", re: /\bfortios\b|\bfortigate\b/ }] },
  { id: "cisco", label: "Cisco", re: /\bcisco\b|\bise\b|ios xe|nx-os/, products: [{ label: "ISE", re: /\bise\b|identity services engine/ }, { label: "IOS XE", re: /ios xe/ }] },
  { id: "microsoft", label: "Microsoft", re: /\bmicrosoft\b|\bwindows\b|\bexchange\b|\bsharepoint\b|\bazure\b|\boutlook\b/, products: [{ label: "Exchange", re: /\bexchange\b/ }, { label: "Windows", re: /\bwindows\b/ }, { label: "SharePoint", re: /\bsharepoint\b/ }] },
  { id: "vmware", label: "VMware", re: /\bvmware\b|\bvcenter\b|\besxi\b/, products: [{ label: "vCenter", re: /\bvcenter\b/ }, { label: "ESXi", re: /\besxi\b/ }] },
  { id: "paloalto", label: "Palo Alto Networks", re: /palo alto|\bpan-os\b|\bglobalprotect\b/, products: [{ label: "PAN-OS", re: /\bpan-os\b/ }] },
  { id: "ivanti", label: "Ivanti", re: /\bivanti\b/ },
  { id: "citrix", label: "Citrix", re: /\bcitrix\b|\bnetscaler\b/, products: [{ label: "NetScaler", re: /\bnetscaler\b/ }] },
  { id: "checkpoint", label: "Check Point", re: /check\s*point|\bcheckpoint\b/ },
  { id: "google", label: "Google", re: /\bgoogle\b|\bchrome\b|\bandroid\b/, products: [{ label: "Chrome", re: /\bchrome\b/ }, { label: "Android", re: /\bandroid\b/ }] },
  { id: "linux", label: "Linux Kernel", re: /\blinux kernel\b|\bkernels?\b/ },
  { id: "sonicwall", label: "SonicWall", re: /\bsonicwall\b/ },
  { id: "f5", label: "F5", re: /\bf5\b|\bbig-ip\b/, products: [{ label: "BIG-IP", re: /\bbig-ip\b/ }] },
  { id: "okta", label: "Okta", re: /\bokta\b/ },
  { id: "atlassian", label: "Atlassian", re: /\batlassian\b|\bconfluence\b|\bjira\b/ },
  { id: "oracle", label: "Oracle", re: /\boracle\b/ },
  { id: "adobe", label: "Adobe", re: /\badobe\b/ },
  { id: "apple", label: "Apple", re: /\bapple\b|\bios\b|\bmacos\b|\bsafari\b/ },
];

export function extractCves(text: string): string[] {
  const found = text.match(CVE_RE) ?? [];
  return [...new Set(found.map((cve) => cve.toUpperCase()))];
}

function parseCvss(blob: string): number | undefined {
  const hit = blob.match(CVSS_RE);
  if (!hit) return undefined;
  const n = Number(hit[1]);
  if (!Number.isFinite(n) || n < 0 || n > 10) return undefined;
  return n;
}

function parseEpss(blob: string): { epss?: number; percentile?: number } {
  const pct = blob.match(EPSS_PCT_RE);
  let percentile: number | undefined;
  if (pct) {
    const n = Number(pct[1]);
    if (Number.isFinite(n)) percentile = n > 1 ? n / 100 : n;
  }
  const hit = blob.match(EPSS_RE);
  if (!hit) return { percentile };
  const n = Number(hit[1]);
  if (!Number.isFinite(n)) return { percentile };
  const isPercent = hit[2] === "%" || n > 1;
  return { epss: isPercent ? n / 100 : n, percentile };
}

function severityFrom(blob: string, cvss?: number): Severity {
  if (cvss != null) {
    if (cvss >= 9) return "critical";
    if (cvss >= 7) return "high";
    if (cvss >= 4) return "medium";
    if (cvss > 0) return "low";
  }
  if (/\bcritical\b/.test(blob) || /\b9\.\d\b/.test(blob) && /cvss|severity/.test(blob)) return "critical";
  if (/\bhigh[- ]severity\b|\bseverity:\s*high\b|\bhigh risk\b/.test(blob)) return "high";
  if (/\bmedium[- ]severity\b|\bseverity:\s*medium\b/.test(blob)) return "medium";
  if (/\blow[- ]severity\b|\bseverity:\s*low\b/.test(blob)) return "low";
  return "unknown";
}

function matchVendor(blob: string): { vendor?: string; products: string[] } {
  for (const row of VENDORS) {
    if (!row.re.test(blob)) continue;
    const products = (row.products ?? []).filter((p) => p.re.test(blob)).map((p) => p.label);
    return { vendor: row.label, products };
  }
  return { products: [] };
}

const DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|hk|gov|edu|info|biz|co|uk|cn|ru|de|fr|jp|kr|sg|au|xyz|top|app|dev|cloud|security)\b/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const FILENAME_RE = /\b[\w.-]+\.(?:exe|dll|ps1|bat|cmd|js|vbs|hta|jar|msi|scr|docm|xlsm|zip|rar|7z)\b/gi;

function extractIocs(text: string): IOC[] {
  const out: IOC[] = [];
  const seen = new Set<string>();
  const add = (type: IocType, value: string) => {
    const key = `${type}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, value });
  };
  for (const m of text.match(/\b[a-fA-F0-9]{64}\b/g) ?? []) add("sha256", m.toLowerCase());
  for (const m of text.match(/\b[a-fA-F0-9]{40}\b/g) ?? []) add("sha1", m.toLowerCase());
  for (const m of text.match(/\b[a-fA-F0-9]{32}\b/g) ?? []) add("md5", m.toLowerCase());
  for (const m of text.match(/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g) ?? []) {
    if (m.startsWith("0.") || m.startsWith("255.")) continue;
    add("ipv4", m);
  }
  for (const m of text.match(/\bhttps?:\/\/[^\s<>"']+/gi) ?? []) {
    const clean = m.replace(/[),.;]+$/, "");
    try {
      const host = new URL(clean).hostname.toLowerCase();
      if (host && !host.includes("google.com") && !host.includes("news.")) {
        add("url", clean);
        add("domain", host);
      }
    } catch {
      /* ignore */
    }
  }
  for (const m of text.match(DOMAIN_RE) ?? []) {
    const host = m.toLowerCase();
    if (host.includes("google.com") || host.includes("example.com")) continue;
    add("domain", host);
  }
  for (const m of text.match(EMAIL_RE) ?? []) add("email", m.toLowerCase());
  for (const m of text.match(FILENAME_RE) ?? []) add("filename", m);
  return out.slice(0, 16);
}

function hkReasonsFor(article: Article, blob: string): string[] {
  const reasons: string[] = [];
  const src = `${article.source} ${article.sourceId}`.toLowerCase();
  if (src.includes("hkcert")) reasons.push("source-hkcert");
  if (src.includes("govcert")) reasons.push("source-govcert");
  if (src.includes("cybersechub")) reasons.push("source-cybersechub");
  if (/hong kong|\bhkcert\b|\bgovcert\b|香港/.test(blob) || /\bhk\b/.test(blob)) reasons.push("mentions-hk");
  return [...new Set(reasons)];
}

function isApac(blob: string, hk: string[]): boolean {
  if (hk.length) return true;
  return /asia[- ]pacific|\bapac\b|singapore|japan|korea|australia|taiwan|india|malaysia|philippines|thailand|indonesia|vietnam/.test(blob);
}

function extractMitre(blob: string): MitreRef[] {
  const ids = [...new Set((blob.match(MITRE_RE) ?? []).map((id) => id.toUpperCase()))];
  return ids.map((technique) => ({
    technique,
    tactic: /t1190/i.test(technique) ? "Initial Access" : undefined,
  }));
}

function articleStamp(article: Article): string {
  return article.pubDate || article.fetchedAt;
}

function worseSeverity(a: Severity, b: Severity): Severity {
  const order: Severity[] = ["unknown", "low", "medium", "high", "critical"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

export function clusterArticles(
  articles: Article[],
  enrichment: Record<string, { cvss?: number; epss?: number; epssPercentile?: number; kev?: boolean; vendor?: string; product?: string }> = {},
): IntelCluster[] {
  const groups: Article[][] = [];
  for (const article of articles) {
    const cves = extractCves(`${article.title} ${article.description}`);
    let hit = -1;
    for (let i = 0; i < groups.length; i += 1) {
      const lead = groups[i][0];
      const leadCves = extractCves(`${lead.title} ${lead.description}`);
      const shareCve = cves.some((cve) => leadCves.includes(cve));
      if (shareCve) {
        hit = i;
        break;
      }
      if (cves.length && leadCves.length && !shareCve) continue;
      if (sameStory(article, lead)) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) groups[hit].push(article);
    else groups.push([article]);
  }

  return groups
    .map((items) => {
      const sorted = [...items].sort((a, b) => articleStamp(b).localeCompare(articleStamp(a)));
      const newest = sorted[0];
      const oldest = [...items].sort((a, b) => articleStamp(a).localeCompare(articleStamp(b)))[0];
      const blob = items.map((a) => `${a.title} ${a.description}`).join("\n").toLowerCase();
      const cves = extractCves(blob);
      const cvss = parseCvss(blob);
      const { epss, percentile } = parseEpss(blob);
      const vendorHit = matchVendor(blob);
      const summarySource = sorted.find((a) => a.description && a.description.length > 40 && a.description.toLowerCase() !== a.title.toLowerCase());
      const hk = items.flatMap((a) => hkReasonsFor(a, `${a.title} ${a.description}`.toLowerCase()));
      const uniqueHk = [...new Set(hk)];
      const id = cves.length ? `cve:${cves.slice().sort().join(",")}` : `story:${titleTokens(newest.title).slice(0, 8).join("-") || newest.id}`;
      const official = cves.map((cve) => enrichment[cve]).filter(Boolean);
      const officialCvss = official.map((row) => row.cvss).filter((n): n is number => typeof n === "number");
      const officialEpss = official.map((row) => row.epss).filter((n): n is number => typeof n === "number");
      const officialPct = official.map((row) => row.epssPercentile).filter((n): n is number => typeof n === "number");
      const officialKev = official.some((row) => row.kev);
      const officialVendor = official.find((row) => row.vendor)?.vendor;
      const officialProduct = official.find((row) => row.product)?.product;
      const mergedCvss = officialCvss.length ? Math.max(...officialCvss) : cvss;
      const mergedEpss = officialEpss.length ? Math.max(...officialEpss) : epss;
      const mergedPct = officialPct.length ? Math.max(...officialPct) : percentile;
      let mergedSeverity = items.reduce<Severity>(
        (sev, a) => worseSeverity(sev, severityFrom(`${a.title} ${a.description}`.toLowerCase(), parseCvss(`${a.title} ${a.description}`.toLowerCase()))),
        "unknown",
      );
      if (mergedCvss != null) {
        if (mergedCvss >= 9) mergedSeverity = "critical";
        else if (mergedCvss >= 7) mergedSeverity = worseSeverity(mergedSeverity, "high");
        else if (mergedCvss >= 4) mergedSeverity = worseSeverity(mergedSeverity, "medium");
      }
      return {
        id,
        title: newest.title,
        summary: (summarySource?.description || newest.description || "").slice(0, 280),
        articles: sorted,
        cves,
        vendor: vendorHit.vendor || officialVendor,
        products: vendorHit.products.length ? vendorHit.products : officialProduct ? [officialProduct] : [],
        severity: mergedSeverity,
        cvss: mergedCvss,
        epss: mergedEpss,
        epssPercentile: mergedPct,
        kev: officialKev || KEV_RE.test(blob),
        kevMentioned: officialKev || KEV_RE.test(blob),
        exploitPublic: EXPLOIT_PUBLIC_RE.test(blob),
        exploited: EXPLOITED_RE.test(blob) || officialKev || KEV_RE.test(blob),
        firstSeen: articleStamp(oldest),
        lastSeen: articleStamp(newest),
        sources: [...new Set(items.map((a) => a.source))],
        iocs: extractIocs(items.map((a) => `${a.title} ${a.description}`).join("\n")),
        mitre: extractMitre(blob),
        hkReasons: uniqueHk,
        apac: isApac(blob, uniqueHk),
        unread: items.some((a) => !a.read),
      } satisfies IntelCluster;
    })
    .sort((a, b) => {
      const order: Severity[] = ["unknown", "low", "medium", "high", "critical"];
      const sev = order.indexOf(b.severity) - order.indexOf(a.severity);
      if (sev) return sev;
      if (a.kev !== b.kev) return a.kev ? -1 : 1;
      return b.lastSeen.localeCompare(a.lastSeen);
    });
}

export function whyThisMatters(cluster: IntelCluster, watchMatches: string[]): string[] {
  const reasons: string[] = [];
  if (cluster.kev) reasons.push("kev");
  if (cluster.exploitPublic) reasons.push("public-exploit");
  if (cluster.exploited && !cluster.kev) reasons.push("exploited");
  if (cluster.epss != null && cluster.epss >= 0.5) reasons.push("high-epss");
  if (cluster.cvss != null && cluster.cvss >= 9) reasons.push("cvss-critical");
  if (watchMatches.length) reasons.push("watchlist");
  if (cluster.sources.length >= 3) reasons.push("multi-source");
  if (cluster.hkReasons.length) reasons.push("hk");
  return reasons;
}

export function hoursAgo(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}

function topicHit(cluster: IntelCluster, topic: TopicFilter): boolean {
  if (!topic) return true;
  const blob = `${cluster.title} ${cluster.summary}`.toLowerCase();
  if (topic === "breaches") return /breach|ransomware|data leak/.test(blob);
  if (topic === "vulns") return /cve-|vulnerab|zero-day|zero day|0-day|exploit|rce|authentication bypass/.test(blob);
  if (topic === "malware") return /malware|infostealer|info-stealer|trojan|botnet|backdoor|\brat\b|stealer/.test(blob);
  if (topic === "phishing") return /phish|smish|bec\b|business email compromise|spear-?phish/.test(blob);
  if (topic === "apt") return /\bapt\b|nation-state|state-sponsored|espionage/.test(blob);
  if (topic === "patch") return /emergency patch|out-of-band|patch tuesday|known exploited|cisa kev/.test(blob);
  return true;
}

export function parseIntelQuery(input: string): { filters: Partial<IntelFilters>; text: string } {
  const filters: Partial<IntelFilters> = {};
  const rest: string[] = [];
  for (const raw of input.trim().split(/\s+/).filter(Boolean)) {
    const [key, ...tail] = raw.split(":");
    const value = tail.join(":").trim();
    if (!value || !key) {
      rest.push(raw);
      continue;
    }
    const k = key.toLowerCase();
    const v = value.toLowerCase();
    if (k === "vendor") filters.vendor = value;
    else if (k === "product") filters.product = value;
    else if (k === "source") filters.source = value;
    else if (k === "cve") rest.push(value.toUpperCase().startsWith("CVE-") ? value.toUpperCase() : `CVE-${value}`);
    else if (k === "kev") filters.kev = v === "true" || v === "yes" || v === "1" ? "yes" : v === "false" || v === "no" ? "no" : "";
    else if (k === "severity") {
      const sev = v as Severity;
      if (["critical", "high", "medium", "low", "unknown"].includes(sev)) filters.severities = [sev];
    } else if (k === "epss") {
      const n = Number(v.replace(/^>/, ""));
      if (Number.isFinite(n)) {
        filters.epssMin = n > 1 ? n / 100 : n;
        filters.epssHigh = (n > 1 ? n / 100 : n) >= 0.5;
      }
    } else if (k === "topic") {
      if (["breaches", "vulns", "malware", "phishing", "apt", "patch", "ransomware"].includes(v)) {
        filters.topic = (v === "ransomware" ? "breaches" : v) as TopicFilter;
      }
    } else if (k === "last" || k === "time") {
      if (v === "1h" || v === "hour") filters.time = "1h";
      else if (v === "6h") filters.time = "6h";
      else if (v === "24h" || v === "day") filters.time = "24h";
      else if (v === "7d" || v === "week") filters.time = "7d";
      else if (v === "30d" || v === "month") filters.time = "30d";
    } else if (k === "region") {
      if (v === "hk" || v === "hongkong") filters.region = "hk";
      else if (v === "apac") filters.region = "apac";
      else if (v === "global") filters.region = "global";
    } else rest.push(raw);
  }

  // Soft parse: "fortinet critical kev" without operators
  const soft = rest.map((w) => w.toLowerCase());
  if (!filters.severities?.length) {
    for (const sev of ["critical", "high", "medium", "low"] as Severity[]) {
      if (soft.includes(sev)) {
        filters.severities = [sev];
        break;
      }
    }
  }
  if (!filters.kev && soft.includes("kev")) filters.kev = "yes";

  return { filters, text: rest.join(" ") };
}

function matchesKeyword(cluster: IntelCluster, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  const blob = `${cluster.title} ${cluster.summary} ${cluster.cves.join(" ")} ${cluster.vendor ?? ""} ${cluster.products.join(" ")} ${cluster.sources.join(" ")} ${cluster.iocs.map((i) => i.value).join(" ")}`.toLowerCase();
  if (blob.includes(lower)) return true;
  if (/^cve-\d{4}-\d{4,7}$/i.test(q) && cluster.cves.some((cve) => cve.toLowerCase() === lower)) return true;
  return false;
}

export function detectIndicator(raw: string): { type: string; value: string } | null {
  const q = raw.trim();
  if (!q) return null;
  if (/^CVE-\d{4}-\d{4,7}$/i.test(q)) return { type: "cve", value: q.toUpperCase() };
  if (/^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(q)) return { type: "ipv4", value: q };
  if (/^[a-fA-F0-9]{64}$/.test(q)) return { type: "sha256", value: q.toLowerCase() };
  if (/^[a-fA-F0-9]{40}$/.test(q)) return { type: "sha1", value: q.toLowerCase() };
  if (/^[a-fA-F0-9]{32}$/.test(q)) return { type: "md5", value: q.toLowerCase() };
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(q) && !q.includes(" ")) return { type: "domain", value: q.toLowerCase() };
  return null;
}

export function filterClusters(
  clusters: IntelCluster[],
  filters: IntelFilters,
  keyword: string,
  watchlist: string[],
  savedIds: Set<string>,
): IntelCluster[] {
  const q = keyword.trim().toLowerCase();
  return clusters.filter((cluster) => {
    if (filters.time === "today" && !cluster.articles.some((a) => isToday(a.pubDate || a.fetchedAt))) return false;
    if (filters.time === "1h" && hoursAgo(cluster.lastSeen) > 1) return false;
    if (filters.time === "6h" && hoursAgo(cluster.lastSeen) > 6) return false;
    if (filters.time === "24h" && hoursAgo(cluster.lastSeen) > 24) return false;
    if (filters.time === "7d" && hoursAgo(cluster.lastSeen) > 24 * 7) return false;
    if (filters.time === "30d" && hoursAgo(cluster.lastSeen) > 24 * 30) return false;
    if (filters.severities.length && !filters.severities.includes(cluster.severity)) return false;
    if (filters.kev === "yes" && !cluster.kev) return false;
    if (filters.kev === "no" && cluster.kev) return false;
    if (filters.epssHigh && !(cluster.epss != null && cluster.epss >= 0.5)) return false;
    if (filters.epssMin != null && (cluster.epss == null || cluster.epss < filters.epssMin)) return false;
    if (filters.vendor && !(cluster.vendor || "").toLowerCase().includes(filters.vendor.toLowerCase())) {
      const blob = `${cluster.title} ${cluster.summary}`.toLowerCase();
      if (!blob.includes(filters.vendor.toLowerCase())) return false;
    }
    if (filters.product) {
      const hit = cluster.products.some((p) => p.toLowerCase().includes(filters.product.toLowerCase()));
      const blob = `${cluster.title} ${cluster.summary}`.toLowerCase().includes(filters.product.toLowerCase());
      if (!hit && !blob) return false;
    }
    if (filters.source && !cluster.sources.some((s) => s.toLowerCase().includes(filters.source.toLowerCase()))) return false;
    if (filters.region === "hk" && !cluster.hkReasons.length) return false;
    if (filters.region === "apac" && !cluster.apac) return false;
    if (!topicHit(cluster, filters.topic)) return false;
    if (filters.unreadOnly && !cluster.unread) return false;
    if (filters.savedOnly && !savedIds.has(cluster.id)) return false;
    if (filters.exploitedOnly && !(cluster.exploited || cluster.kev || cluster.exploitPublic)) return false;
    const watchMatches = watchlistMatches(cluster, watchlist);
    if (filters.watchlistOnly && !watchMatches.length) return false;
    if (q && !matchesKeyword(cluster, q)) return false;
    return true;
  });
}

export function watchlistMatches(cluster: IntelCluster, watchlist: string[]): string[] {
  if (!watchlist.length) return [];
  const blob = `${cluster.title} ${cluster.summary} ${cluster.vendor ?? ""} ${cluster.products.join(" ")} ${cluster.cves.join(" ")}`.toLowerCase();
  return watchlist.filter((item) => item.trim() && blob.includes(item.trim().toLowerCase()));
}

export function watchlistMatchDetail(cluster: IntelCluster, matches: string[]): string {
  if (!matches.length) return "";
  const parts: string[] = [];
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (cluster.vendor?.toLowerCase().includes(lower) && cluster.products.length) {
      parts.push(`${cluster.vendor} → ${cluster.products.join(", ")}`);
    } else if (cluster.cves.some((c) => c.toLowerCase().includes(lower))) {
      parts.push(cluster.cves.find((c) => c.toLowerCase().includes(lower)) ?? m);
    } else {
      parts.push(m);
    }
  }
  return [...new Set(parts)].join(" · ");
}

export type ClusterMetrics = {
  critical: number;
  kev: number;
  epss: number;
  watchlist: number;
  newCve: number;
  exploited: number;
  total: number;
};

export function clusterMetrics(clusters: IntelCluster[], watchlist: string[]): ClusterMetrics {
  return {
    critical: clusters.filter((c) => c.severity === "critical").length,
    kev: clusters.filter((c) => c.kev).length,
    epss: clusters.filter((c) => c.epss != null && c.epss >= 0.5).length,
    watchlist: clusters.filter((c) => watchlistMatches(c, watchlist).length > 0).length,
    newCve: clusters.filter((c) => c.cves.length > 0 && hoursAgo(c.lastSeen) <= 24).length,
    exploited: clusters.filter((c) => c.exploited || c.kev).length,
    total: clusters.length,
  };
}

/** Prioritize watchlist → critical → KEV → high EPSS → newest within a filtered set. */
export function prioritizeFeed(clusters: IntelCluster[], watchlist: string[]): IntelCluster[] {
  const rank = (c: IntelCluster) => {
    const watch = watchlistMatches(c, watchlist).length ? 0 : 1;
    const critical = c.severity === "critical" ? 0 : 1;
    const kev = c.kev ? 0 : 1;
    const epss = c.epss != null && c.epss >= 0.5 ? 0 : 1;
    return [watch, critical, kev, epss, c.lastSeen];
  };
  return [...clusters].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < 4; i += 1) {
      if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
    }
    return String(rb[4]).localeCompare(String(ra[4]));
  });
}

export function uniqueVendors(clusters: IntelCluster[]): string[] {
  return [...new Set(clusters.map((c) => c.vendor).filter((v): v is string => Boolean(v)))].sort();
}

export function uniqueSources(clusters: IntelCluster[]): string[] {
  return [...new Set(clusters.flatMap((c) => c.sources))].sort();
}

export function uniqueProducts(clusters: IntelCluster[]): string[] {
  return [...new Set(clusters.flatMap((c) => c.products))].sort();
}

export function activeFilterCount(filters: IntelFilters, keyword: string): number {
  let n = 0;
  if (filters.time && filters.time !== DEFAULT_TIME) n += 1;
  if (filters.time === DEFAULT_TIME) n += 1; // still show default as active chip
  n += filters.severities.length;
  if (filters.kev) n += 1;
  if (filters.epssHigh || filters.epssMin != null) n += 1;
  if (filters.vendor) n += 1;
  if (filters.product) n += 1;
  if (filters.source) n += 1;
  if (filters.region) n += 1;
  if (filters.topic) n += 1;
  if (filters.watchlistOnly) n += 1;
  if (filters.unreadOnly) n += 1;
  if (filters.savedOnly) n += 1;
  if (filters.exploitedOnly) n += 1;
  if (keyword.trim()) n += 1;
  return n;
}

export function formatHkClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}
