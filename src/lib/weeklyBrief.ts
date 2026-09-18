import { polishGoogleNewsArticle } from "./googleNews";
import { newsletterDateStamp, newsletterFileStamp } from "./reportPayload";
import { dedupeStories, hkTodayStamp, isEventOrWebinar, relevanceScore, sameStory } from "./rank";
import type { Article } from "./types";

export type BriefLevel = "red" | "amber" | "green";

export type BriefAssetId = "edge" | "virt" | "identity" | "supply" | "ransom" | "apt" | "general";

export type BriefTopic = {
  title: string;
  why: string;
  asset: string;
  assetId: BriefAssetId;
  ask: string;
  say: string;
  level: BriefLevel;
  source: string;
  url: string;
  related: number;
};

export type WeeklyBrief = {
  weekLabel: string;
  fileStamp: string;
  basename: string;
  overall: BriefLevel;
  summary: string;
  scanned: number;
  topics: BriefTopic[];
};

const EXPLOITED_RE =
  /actively exploited|known exploited|in the wild|zero-day|zero day|0-day|emergency patch|out-of-band|ransomware/;

const ASSETS: Array<{ id: BriefAssetId; label: string; re: RegExp }> = [
  {
    id: "edge",
    label: "Edge / VPN / firewall",
    re: /\bcisco\b|fortinet|fortigate|\bcitrix\b|netscaler|\bivanti\b|sonicwall|palo alto|globalprotect|\bvpn\b|firewall management|\bfmc\b/,
  },
  {
    id: "virt",
    label: "Virtualization (vCenter / ESXi)",
    re: /\bvmware\b|\bvcenter\b|\besxi\b/,
  },
  {
    id: "supply",
    label: "Supply chain / vendor",
    re: /supply[- ]chain|clickfix|third[- ]party|vendor breach|brevo/,
  },
  {
    id: "identity",
    label: "Identity / email",
    re: /infostealer|info-stealer|business email compromise|phishing|stolen credential|credential theft|\bokta\b|microsoft 365|entra id/,
  },
  {
    id: "ransom",
    label: "Ransomware / extortion",
    re: /ransomware|leak site|extortion/,
  },
  {
    id: "apt",
    label: "Espionage / APT",
    re: /\bapt\b|nation-state|state-sponsored|espionage/,
  },
];

const COPY: Record<BriefAssetId, { why: string; ask: string; say: string }> = {
  edge: {
    why: "Internet-facing appliances are a favourite initial-access path. One unpatched gateway can let an attacker in without phishing.",
    ask: "Count internet-facing Cisco / Fortinet / Citrix / Ivanti / Palo Alto devices and patch any actively exploited issue within 48 hours.",
    say: "If any of these boxes sit on the internet, this is a 48-hour patch, not a news item.",
  },
  virt: {
    why: "Compromise of vCenter or ESXi can lock many systems at once. Ransomware groups now treat virtualization as a high-value target.",
    ask: "Confirm vCenter is not internet-exposed, KEV patches are applied, and recent admin sessions look normal.",
    say: "Ask whether vCenter can be reached from outside. If nobody knows, that is the finding.",
  },
  supply: {
    why: "A trusted vendor or mailing platform can plant malware on staff or customer sites. This bypasses the perimeter.",
    ask: "Check whether we use the affected vendor; freeze unsolicited links from that channel until verified.",
    say: "Name the vendor. If we use them, freeze that channel until IT confirms.",
  },
  identity: {
    why: "Stolen passwords and BEC remain the most common path into HK organisations. Finance and HR mailboxes are the usual prize.",
    ask: "Confirm MFA on finance and HR email, and block the related lures at the mail gateway this week.",
    say: "Finance and HR email are the prize. MFA on or off is the only question.",
  },
  ransom: {
    why: "Active ransomware campaigns mean a single foothold can become encryption plus extortion within hours.",
    ask: "Verify backups are offline-tested and that edge / identity controls above are closed this week.",
    say: "The decision is a backup restore test. Everything else is noise.",
  },
  apt: {
    why: "State-linked intrusion is slower than ransomware but aims at mail, credentials, and long-term access.",
    ask: "Treat this as awareness unless the victim sector matches us; keep logging on mail and VPN for unusual admin use.",
    say: "Awareness unless the victim looks like us. Do not spend the meeting on the group name.",
  },
  general: {
    why: "This is the strongest remaining story this week. It is worth knowing, not necessarily an emergency for our stack.",
    ask: "Note it for SOC monitoring; no management decision required unless it maps to our systems.",
    say: "Worth watching. No decision unless it maps to a system we actually run.",
  },
};

function blobOf(article: Pick<Article, "title" | "description">): string {
  return `${article.title} ${article.description}`.toLowerCase();
}

function articleHkStamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const midnightUtc =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (midnightUtc) return iso.slice(0, 10);
  return hkTodayStamp(d);
}

export function isLastNHkDays(iso: string | null, days: number, now = new Date()): boolean {
  const stamp = articleHkStamp(iso);
  if (!stamp) return false;
  const today = hkTodayStamp(now);
  const then = Date.parse(`${stamp}T00:00:00+08:00`);
  const current = Date.parse(`${today}T00:00:00+08:00`);
  if (Number.isNaN(then) || Number.isNaN(current)) return false;
  const diff = (current - then) / 86_400_000;
  return diff >= 0 && diff < days;
}

function weekLabel(now = new Date()): string {
  const end = newsletterDateStamp(now);
  const startDate = new Date(now.getTime() - 6 * 86_400_000);
  const start = newsletterDateStamp(startDate);
  if (start === end) return end;
  const startDay = start.split(" ")[0];
  const startRest = start.split(" ").slice(1).join(" ");
  const endRest = end.split(" ").slice(1).join(" ");
  if (startRest === endRest) return `${startDay}–${end}`;
  return `${start} – ${end}`;
}

function classify(article: Article): { assetId: BriefAssetId; asset: string; exploited: boolean; score: number; level: BriefLevel } {
  const blob = blobOf(article);
  const exploited = EXPLOITED_RE.test(blob);
  const hit = ASSETS.find((item) => item.re.test(blob));
  const assetId = hit?.id ?? "general";
  const asset = hit?.label ?? "General cyber risk";
  let score = relevanceScore(article);
  if (assetId === "edge" || assetId === "virt") score += 0.35;
  if (exploited) score += 0.4;
  if (assetId === "ransom") score += 0.2;
  if (assetId === "identity" || assetId === "supply") score += 0.15;
  if (assetId === "apt") score += 0.05;
  if (/clickfix|brevo/.test(blob)) score += 0.12;
  if (/\bsurge\b|outlook \d{4}|guide to|what recent/.test(blob)) score -= 0.12;
  if (
    /\brussia|\brussian\b|\biran|\biranian\b|\bukraine\b|\bbahrain\b|\buae\b/.test(blob) &&
    !/hong kong|\bhk\b|asia-pacific|\bapac\b/.test(blob)
  ) {
    score -= 0.28;
  }

  let level: BriefLevel = "green";
  if ((assetId === "edge" || assetId === "virt") && exploited) level = "red";
  else if (assetId === "ransom" && exploited) level = "red";
  else if (assetId === "identity" || assetId === "supply" || score >= 0.25) level = "amber";

  return { assetId, asset, exploited, score, level };
}

function rankWorse(a: BriefLevel, b: BriefLevel): BriefLevel {
  const order: BriefLevel[] = ["green", "amber", "red"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function summaryLine(overall: BriefLevel, topics: BriefTopic[]): string {
  if (!topics.length) return "No high-signal stories in the last 7 days. Refresh feeds and try again.";
  if (overall === "red") {
    const assets = [...new Set(topics.filter((t) => t.level === "red").map((t) => t.asset))];
    return `This week needs action: ${assets.join(" and ")} under active exploitation.`;
  }
  if (overall === "amber") {
    return "No confirmed gateway emergency, but identity or supply-chain risk needs a decision this week.";
  }
  return "No actively exploited edge or virtualization story this week. Awareness only.";
}

function toTopic(article: Article, meta: ReturnType<typeof classify>, related: number): BriefTopic {
  const polished = polishGoogleNewsArticle(article);
  const copy = COPY[meta.assetId];
  return {
    title: polished.title.trim() || "Untitled",
    why: copy.why,
    asset: meta.asset,
    assetId: meta.assetId,
    ask: copy.ask,
    say: copy.say,
    level: meta.level,
    source: polished.source,
    url: polished.url,
    related,
  };
}

const EMPTY_TOPIC: BriefTopic = {
  title: "No additional high-signal story",
  why: "The remaining headlines this week did not clear the management bar.",
  asset: "—",
  assetId: "general",
  ask: "No extra decision required.",
  say: "Skip. No further decision this week.",
  level: "green",
  source: "",
  url: "",
  related: 0,
};

export function buildWeeklyBrief(articles: Article[], now = new Date()): WeeklyBrief {
  const rawWeek = articles.filter((a) => !isEventOrWebinar(a) && isLastNHkDays(a.pubDate || a.fetchedAt, 7, now));
  const week = dedupeStories(rawWeek);
  const ranked = week
    .map((article) => ({ article, ...classify(article) }))
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.0001) return b.score - a.score;
      return (b.article.pubDate || b.article.fetchedAt).localeCompare(a.article.pubDate || a.article.fetchedAt);
    });

  const picked: typeof ranked = [];
  for (const pass of ["diverse", "any"] as const) {
    for (const row of ranked) {
      if (picked.length >= 3) break;
      if (picked.some((item) => sameStory(item.article, row.article))) continue;
      if (pass === "diverse" && picked.some((item) => item.assetId === row.assetId)) continue;
      picked.push(row);
    }
  }

  const topics = picked.map((row) => {
    const related = Math.max(
      1,
      rawWeek.filter((item) => sameStory(item, row.article)).length,
    );
    return toTopic(row.article, row, related);
  });
  while (topics.length < 3) topics.push({ ...EMPTY_TOPIC });

  const overall = topics.reduce<BriefLevel>((level, topic) => rankWorse(level, topic.level), "green");
  const fileStamp = newsletterFileStamp(now);
  return {
    weekLabel: weekLabel(now),
    fileStamp,
    basename: `Weekly Management Brief ${fileStamp}`,
    overall,
    summary: summaryLine(overall, topics.filter((t) => t.url)),
    scanned: week.length,
    topics,
  };
}

export function isWeeklyBrief(value: unknown): value is WeeklyBrief {
  if (!value || typeof value !== "object") return false;
  const v = value as WeeklyBrief;
  return (
    typeof v.weekLabel === "string" &&
    typeof v.basename === "string" &&
    (v.overall === "red" || v.overall === "amber" || v.overall === "green") &&
    typeof v.summary === "string" &&
    Array.isArray(v.topics) &&
    v.topics.length === 3
  );
}
