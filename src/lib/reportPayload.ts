import { polishGoogleNewsArticle } from "./googleNews";
import { top10 } from "./rank";
import type { AgencyItem, Article } from "./types";

export type ReportItem = {
  title: string;
  source: string;
  url: string;
};

export type ReportSection = {
  heading: string;
  items: ReportItem[];
};

export type ReportPayload = {
  dateStamp: string;
  fileStamp: string;
  basename: string;
  topItems: Array<ReportItem | null>;
  sections: ReportSection[];
};

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function newsletterFileStamp(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function newsletterDateStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(date);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const year = Number(parts.find((p) => p.type === "year")?.value ?? date.getFullYear());
  return `${day} ${EN_MONTHS[month - 1]} ${year}`;
}

function cleanSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function titleFromAlertUrl(url: string): string {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    const words = slug
      .replace(/_[0-9]{8}$/, "")
      .replace(/[_-]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !/^(hkcert|govcert|cybersechub|security|bulletin)$/i.test(w))
      .map((w) => (/^(cve|api|apt|dos|rce)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));
    return cleanSpaces(words.join(" "));
  } catch {
    return "";
  }
}

export function normalizeExternalAlertTitle(title: string, source: string, url: string, maxLen = 88): string {
  let raw = cleanSpaces(title);
  const fallback = titleFromAlertUrl(url) || cleanSpaces(source) || "Nil";
  if (!raw) return fallback;

  const gov = raw.match(/^Security Alert\s*\([^)]*\)\s*:\s*(.+)$/i);
  if (gov) raw = cleanSpaces(gov[1]);

  if (raw.length > maxLen || (raw.match(/,/g) ?? []).length >= 2) {
    raw = raw.split(/\.\s+|;\s+|,\s+(?:a|an|the)\s+/, 2)[0]?.trim() ?? raw;
  }
  raw = raw.replace(/\s+(?:that|which)\s+.*$/i, "").trim();
  raw = raw.replace(/\s+(?:to\s+(?:trigger|allow|perform)\s+.*)$/i, "").trim();
  raw = raw.replace(/[ .,:;-]+$/, "");

  if (raw.length < 12) return fallback;
  if (raw.length > maxLen) return `${raw.slice(0, maxLen - 1).trimEnd()}…`;
  return raw;
}

function asItem(item: { title: string; source: string; url: string }, agency = false): ReportItem {
  const polished = agency ? item : polishGoogleNewsArticle(item);
  const title = agency
    ? normalizeExternalAlertTitle(polished.title, polished.source, polished.url)
    : cleanSpaces(polished.title);
  return {
    title: title || "Nil",
    source: cleanSpaces(polished.source) || "Nil",
    url: cleanSpaces(polished.url) || "Nil",
  };
}

export function buildReportPayload(
  articles: Article[],
  agencies: { hkcert: AgencyItem[]; govcert: AgencyItem[]; cybersechub: AgencyItem[] },
): ReportPayload {
  const tops = top10(articles);
  const fileStamp = newsletterFileStamp();
  return {
    dateStamp: newsletterDateStamp(),
    fileStamp,
    basename: `Feedly News Letter ${fileStamp}`,
    topItems: Array.from({ length: 10 }, (_, i) => {
      const a = tops[i];
      return a ? asItem(a) : null;
    }),
    sections: [
      { heading: "Intelligence from HKCERT", items: agencies.hkcert.map((x) => asItem(x, true)) },
      { heading: "Intelligence from GovCERT.HK", items: agencies.govcert.map((x) => asItem(x, true)) },
      { heading: "Intelligence from Cybersechub", items: agencies.cybersechub.map((x) => asItem(x, true)) },
    ],
  };
}
