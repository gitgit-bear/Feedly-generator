import { polishGoogleNewsArticle } from "./googleNews";
import type { Locale } from "./i18n";
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

const ASSETS: Array<{ id: BriefAssetId; re: RegExp }> = [
  {
    id: "edge",
    re: /\bcisco\b|fortinet|fortigate|\bcitrix\b|netscaler|\bivanti\b|sonicwall|palo alto|globalprotect|\bvpn\b|firewall management|\bfmc\b/,
  },
  {
    id: "virt",
    re: /\bvmware\b|\bvcenter\b|\besxi\b/,
  },
  {
    id: "supply",
    re: /supply[- ]chain|clickfix|third[- ]party|vendor breach|brevo/,
  },
  {
    id: "identity",
    re: /infostealer|info-stealer|business email compromise|phishing|stolen credential|credential theft|\bokta\b|microsoft 365|entra id/,
  },
  {
    id: "ransom",
    re: /ransomware|leak site|extortion/,
  },
  {
    id: "apt",
    re: /\bapt\b|nation-state|state-sponsored|espionage/,
  },
];

const ASSET_LABEL: Record<Locale, Record<BriefAssetId, string>> = {
  en: {
    edge: "Edge / VPN / firewall",
    virt: "Virtualization (vCenter / ESXi)",
    supply: "Supply chain / vendor",
    identity: "Identity / email",
    ransom: "Ransomware / extortion",
    apt: "Espionage / APT",
    general: "General cyber risk",
  },
  zh: {
    edge: "邊緣／VPN／防火牆",
    virt: "虛擬化（vCenter / ESXi）",
    supply: "供應鏈／供應商",
    identity: "身份／電郵",
    ransom: "勒索軟件／勒索",
    apt: "間諜活動／APT",
    general: "一般網絡風險",
  },
};

const COPY: Record<Locale, Record<BriefAssetId, { why: string; ask: string; say: string }>> = {
  en: {
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
  },
  zh: {
    edge: {
      why: "面向互聯網的設備是常見的初始入侵途徑。一台未補丁的閘道就可以讓攻擊者無需釣魚而進入。",
      ask: "盤點面向互聯網的 Cisco／Fortinet／Citrix／Ivanti／Palo Alto 設備，並在 48 小時內為被主動利用的漏洞打補丁。",
      say: "如果這些設備有任何一台在互聯網上，這是 48 小時補丁，不是新聞。",
    },
    virt: {
      why: "vCenter 或 ESXi 一旦失守，可以一次鎖定大量系統。勒索組織已把虛擬化當成高價值目標。",
      ask: "確認 vCenter 沒有暴露在互聯網、已套用 KEV 補丁，以及近期管理員登入正常。",
      say: "問清楚 vCenter 能否從外面連到。如果沒人知道，那就是發現。",
    },
    supply: {
      why: "受信任的供應商或郵件平台可以把惡意程式帶到員工或客戶網站，繞過外圍防線。",
      ask: "查我們有沒有用受影響供應商；在核實前先凍結該渠道未經要求的連結。",
      say: "講出供應商名稱。如果我們有用，凍結該渠道直至 IT 確認。",
    },
    identity: {
      why: "被盜密碼及商務電郵詐騙仍是香港機構最常見的入侵途徑。財務及人事郵箱通常是目標。",
      ask: "確認財務及人事電郵已開 MFA，並在本週於郵件閘道封鎖相關誘餌。",
      say: "財務及人事電郵才是目標。問題只有一個：MFA 開了沒有。",
    },
    ransom: {
      why: "活躍勒索活動代表一個立足點可以在數小時內變成加密加勒索。",
      ask: "核實備份已離線測試，以及上述邊緣／身份控制本週已關閉。",
      say: "決定是做一次備份還原測試。其餘都是噪音。",
    },
    apt: {
      why: "國家相關入侵比勒索慢，但目標是郵件、憑證及長期存取。",
      ask: "除非受害行業與我們相符，否則當知悉處理；繼續監察郵件及 VPN 的異常管理員活動。",
      say: "除非受害者似我們，否則只是知悉。會議不要花在組織名稱上。",
    },
    general: {
      why: "這是本週餘下最值得注意的故事。值得知道，但不一定是我們系統的緊急情況。",
      ask: "交給 SOC 監察；除非對應我們的系統，否則無須管理層決定。",
      say: "值得留意。除非對應我們實際運行的系統，否則無須決定。",
    },
  },
};

const ZH_MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

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

function dateStamp(date: Date, locale: Locale): string {
  if (locale !== "zh") return newsletterDateStamp(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(date);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const year = Number(parts.find((p) => p.type === "year")?.value ?? date.getFullYear());
  return `${year}年${ZH_MONTHS[month - 1]}${day}日`;
}

function weekLabel(now = new Date(), locale: Locale = "en"): string {
  const end = dateStamp(now, locale);
  const startDate = new Date(now.getTime() - 6 * 86_400_000);
  const start = dateStamp(startDate, locale);
  if (start === end) return end;
  if (locale === "zh") return `${start} – ${end}`;
  const startDay = start.split(" ")[0];
  const startRest = start.split(" ").slice(1).join(" ");
  const endRest = end.split(" ").slice(1).join(" ");
  if (startRest === endRest) return `${startDay}–${end}`;
  return `${start} – ${end}`;
}

function classify(
  article: Article,
  locale: Locale,
): { assetId: BriefAssetId; asset: string; exploited: boolean; score: number; level: BriefLevel } {
  const blob = blobOf(article);
  const exploited = EXPLOITED_RE.test(blob);
  const hit = ASSETS.find((item) => item.re.test(blob));
  const assetId = hit?.id ?? "general";
  const asset = ASSET_LABEL[locale][assetId];
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

function summaryLine(overall: BriefLevel, topics: BriefTopic[], locale: Locale): string {
  if (!topics.length) {
    return locale === "zh"
      ? "近 7 日沒有高訊號故事。請更新情報後再試。"
      : "No high-signal stories in the last 7 days. Refresh feeds and try again.";
  }
  if (overall === "red") {
    const assets = [...new Set(topics.filter((t) => t.level === "red").map((t) => t.asset))];
    const joined = locale === "zh" ? assets.join("及") : assets.join(" and ");
    return locale === "zh"
      ? `本週需要行動：${joined}正被主動利用。`
      : `This week needs action: ${joined} under active exploitation.`;
  }
  if (overall === "amber") {
    return locale === "zh"
      ? "未確認閘道緊急情況，但身份或供應鏈風險本週需要決定。"
      : "No confirmed gateway emergency, but identity or supply-chain risk needs a decision this week.";
  }
  return locale === "zh"
    ? "本週沒有被主動利用的邊緣或虛擬化故事。只需知悉。"
    : "No actively exploited edge or virtualization story this week. Awareness only.";
}

function toTopic(article: Article, meta: ReturnType<typeof classify>, related: number, locale: Locale): BriefTopic {
  const polished = polishGoogleNewsArticle(article);
  const copy = COPY[locale][meta.assetId];
  return {
    title: polished.title.trim() || (locale === "zh" ? "無標題" : "Untitled"),
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

function emptyTopic(locale: Locale): BriefTopic {
  return locale === "zh"
    ? {
        title: "沒有其他高訊號故事",
        why: "本週其餘標題未達管理層門檻。",
        asset: "—",
        assetId: "general",
        ask: "無需額外決定。",
        say: "跳過。本週無須再決定。",
        level: "green",
        source: "",
        url: "",
        related: 0,
      }
    : {
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
}

export function buildWeeklyBrief(articles: Article[], now = new Date(), locale: Locale = "en"): WeeklyBrief {
  const rawWeek = articles.filter((a) => !isEventOrWebinar(a) && isLastNHkDays(a.pubDate || a.fetchedAt, 7, now));
  const week = dedupeStories(rawWeek);
  const ranked = week
    .map((article) => ({ article, ...classify(article, locale) }))
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
    return toTopic(row.article, row, related, locale);
  });
  while (topics.length < 3) topics.push(emptyTopic(locale));

  const overall = topics.reduce<BriefLevel>((level, topic) => rankWorse(level, topic.level), "green");
  const fileStamp = newsletterFileStamp(now);
  return {
    weekLabel: weekLabel(now, locale),
    fileStamp,
    basename: `Weekly Management Brief ${fileStamp}`,
    overall,
    summary: summaryLine(overall, topics.filter((t) => t.url), locale),
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
