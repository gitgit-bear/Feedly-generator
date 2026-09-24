"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgencyItem, Article, CacheState } from "@/lib/types";
import { isToday, relevanceScore, top10, dedupeStories } from "@/lib/rank";
import { exportReportFormat, exportWeeklyBriefPdf, isMobileBrowser, reportDownloadUrl, type ExportKind } from "@/lib/saveReport";
import { newsletterFileStamp } from "@/lib/reportPayload";
import { polishGoogleNewsArticle } from "@/lib/googleNews";
import { buildWeeklyBrief } from "@/lib/weeklyBrief";
import { EXPORT_PROGRESS_KEYS, type MessageKey } from "@/lib/i18n";
import { useLocale } from "@/components/LocaleProvider";
import WeeklyBriefSheet from "@/components/WeeklyBriefSheet";
import IntelligenceWorkspace from "@/components/workspace/IntelligenceWorkspace";
import { loadDisabledSources } from "@/lib/analystStore";

type Chip = "today" | "all" | "unread" | "breaches" | "vulns" | "malware" | "phishing" | "apt" | "patch";

type Snapshot = CacheState & {
  todayCount?: number;
  top10?: Article[];
};

type StatusMsg = { key: MessageKey; vars?: Record<string, string | number> } | { raw: string };

const CHIPS: Chip[] = ["today", "all", "unread", "breaches", "vulns", "malware", "phishing", "apt", "patch"];

const CHIP_KEYS: Record<Chip, MessageKey> = {
  today: "chipToday",
  all: "chipAll",
  unread: "chipUnread",
  breaches: "chipBreaches",
  vulns: "chipVulns",
  malware: "chipMalware",
  phishing: "chipPhishing",
  apt: "chipApt",
  patch: "chipPatch",
};

const TOPIC_CHIPS = ["breaches", "vulns", "malware", "phishing", "apt", "patch"] as const;

function matchesChip(a: Article, chip: Chip): boolean {
  if (chip === "all") return true;
  if (chip === "today") return isToday(a.pubDate || a.fetchedAt);
  if (chip === "unread") return !a.read;
  const blob = `${a.title} ${a.description}`.toLowerCase();
  if (chip === "breaches") return /breach|ransomware|data leak/.test(blob);
  if (chip === "vulns") {
    return /cve-|vulnerab|zero-day|zero day|0-day|exploit|rce|remote code execution|authentication bypass/.test(blob);
  }
  if (chip === "malware") return /malware|infostealer|info-stealer|trojan|botnet|backdoor|\brat\b|stealer/.test(blob);
  if (chip === "phishing") return /phish|smish|bec\b|business email compromise|spear-?phish/.test(blob);
  if (chip === "apt") return /\bapt\b|nation-state|state-sponsored|espionage/.test(blob);
  if (chip === "patch") return /emergency patch|out-of-band|patch tuesday|known exploited|cisa kev/.test(blob);
  return false;
}

function tiltCard(el: HTMLElement, clientX: number, clientY: number) {
  if (window.matchMedia("(prefers-reduced-motion: reduce), (hover: none)").matches) return;
  const r = el.getBoundingClientRect();
  const x = (clientX - r.left) / r.width;
  const y = (clientY - r.top) / r.height;
  el.style.transform = `perspective(920px) rotateY(${(x - 0.5) * 14}deg) rotateX(${(0.5 - y) * 11}deg) translateY(-10px) translateZ(20px)`;
}

function resetTilt(el: HTMLElement) {
  el.style.transform = "";
}

function compactText(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldShowDescription(title: string, description: string, source: string): boolean {
  const desc = compactText(description);
  if (!desc) return false;
  const head = compactText(title);
  if (!head) return true;
  if (desc === head) return false;
  const withSource = compactText(`${title} ${source}`);
  if (desc === withSource) return false;
  if (desc.startsWith(head) && desc.length <= head.length + compactText(source).length + 12) return false;
  const words = desc.split(" ");
  if (words.length <= 12) {
    const titleWords = new Set(head.split(" "));
    const overlap = words.filter((word) => titleWords.has(word)).length / words.length;
    if (overlap >= 0.85) return false;
  }
  return true;
}

function relative(iso: string | null, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  if (!iso) return t("timeUnknown");
  const t0 = new Date(iso).getTime();
  if (Number.isNaN(t0)) return t("timeUnknown");
  const mins = Math.max(0, Math.round((Date.now() - t0) / 60000));
  if (mins < 1) return t("timeJustNow");
  if (mins < 60) return t("timeMinutes", { n: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("timeHours", { n: hrs });
  return t("timeDays", { n: Math.round(hrs / 24) });
}

type RefreshEvent =
  | { type: "start"; total: number }
  | { type: "progress"; done: number; total: number; source: string; sourceId?: string; ok?: boolean; error?: string | null; count?: number }
  | { type: "done"; snapshot?: Snapshot }
  | { type: "error"; message?: string };

async function readRefreshStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RefreshEvent) => void,
): Promise<Snapshot> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let snapshot: Snapshot | null = null;

  const handleBlock = (block: string) => {
    const line = block.split(/\r?\n/).find((item) => item.startsWith("data:"));
    if (!line) return;
    const raw = line.replace(/^data:\s*/, "").trim();
    if (!raw) return;
    const event = JSON.parse(raw) as RefreshEvent;
    onEvent(event);
    if (event.type === "done" && event.snapshot) snapshot = event.snapshot;
    if (event.type === "error") throw new Error(event.message || "refresh-failed");
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      handleBlock(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf("\n\n");
    }
    if (done) {
      if (buffer.trim()) handleBlock(buffer);
      break;
    }
  }

  if (!snapshot) throw new Error("Refresh returned no data");
  return snapshot;
}

export default function NewsApp() {
  const { locale, setLocale, t } = useLocale();
  const [data, setData] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(true);
  const [chip, setChip] = useState<Chip>("today");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState<StatusMsg>({ key: "connecting" });
  const [sourceProgress, setSourceProgress] = useState<
    Array<{ sourceId: string; source: string; ok?: boolean; pending?: boolean; error?: string | null; count?: number }>
  >([]);
  const [failedCount, setFailedCount] = useState(0);
  const busyRef = useRef(false);
  const realProgressRef = useRef(false);
  const statusText = "raw" in status ? status.raw : t(status.key, status.vars);

  const applySnapshot = useCallback((snap: Snapshot) => {
    const articles = dedupeStories((snap.articles ?? []).map(polishGoogleNewsArticle));
    const next: Snapshot = {
      ...snap,
      articles,
      todayCount: articles.filter((a) => isToday(a.pubDate || a.fetchedAt)).length,
      top10: top10(articles),
    };
    setData(next);
    try {
      localStorage.setItem("cyberguard-snapshot-v1", JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
    if ((next.todayCount ?? 0) === 0 && next.articles.length > 0) {
      setChip("all");
    }
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/articles", { cache: "no-store" });
    const json = (await res.json()) as Snapshot;
    applySnapshot(json);
  }, [applySnapshot]);

  const pullFeeds = useCallback(async () => {
    setStatus({ key: "loadingFeeds" });
    const res = await fetch("/api/refresh", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skip: loadDisabledSources() }),
    });
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`);

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as { snapshot?: Snapshot };
      if (!json.snapshot) throw new Error("Refresh returned no data");
      applySnapshot(json.snapshot);
      realProgressRef.current = true;
      setPct(100);
      setStatus({ key: "ready" });
      return json.snapshot;
    }

    if (!res.body) throw new Error("Refresh returned no data");

    const snapshot = await readRefreshStream(res.body, (event) => {
      realProgressRef.current = true;
      if (event.type === "start") {
        setPct(4);
        setFailedCount(0);
        setSourceProgress([]);
        setStatus({ key: "refreshingCount", vars: { done: 0, total: event.total } });
        return;
      }
      if (event.type === "progress") {
        const next = event.total ? Math.round((event.done / event.total) * 100) : 0;
        setPct(Math.min(99, Math.max(4, next)));
        setSourceProgress((prev) => {
          const id = event.sourceId || event.source;
          return [
            ...prev.filter((row) => row.sourceId !== id),
            {
              sourceId: id,
              source: event.source,
              ok: event.ok,
              error: event.error,
              count: event.count,
              pending: event.ok == null,
            },
          ];
        });
        if (event.ok === false) setFailedCount((n) => n + 1);
        setStatus({
          key: event.ok === false ? "refreshingSourceFailed" : "refreshingSource",
          vars: { done: event.done, total: event.total, source: event.source },
        });
      }
    });

    applySnapshot(snapshot);
    setPct(100);
    setStatus({ key: "ready" });
    return snapshot;
  }, [applySnapshot]);

  const refresh = useCallback(async () => {
    if (!ready || busyRef.current || exporting) return;
    busyRef.current = true;
    setBusy(true);
    setPct(0);
    setStatus({ key: "refreshingZero" });
    realProgressRef.current = false;
    try {
      await pullFeeds();
      setStatus({ key: "upToDate" });
    } catch {
      setStatus({ key: "refreshFailed" });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setTimeout(() => setPct(0), 800);
    }
  }, [pullFeeds, ready, exporting]);

  useEffect(() => {
    let cancelled = false;
    let stored: Snapshot | null = null;
    try {
      const raw = localStorage.getItem("cyberguard-snapshot-v1");
      stored = raw ? (JSON.parse(raw) as Snapshot) : null;
      if (!Array.isArray(stored?.articles) || !stored.articles.length) stored = null;
    } catch {
      stored = null;
    }

    if (stored) {
      applySnapshot(stored);
      setPct(100);
      setStatus({ key: "updating" });
      setReady(true);
    }

    void (async () => {
      try {
        if (!stored) setStatus({ key: "loadingFeeds" });
        const res = await fetch("/api/articles", { cache: "no-store" });
        const json = (await res.json()) as Snapshot;
        if (cancelled) return;
        if (json.articles?.length) {
          applySnapshot(json);
          setPct(100);
          setStatus({ key: "ready" });
          setReady(true);
          return;
        }
        const snap = await pullFeeds();
        if (cancelled) return;
        if (!snap.articles.length) setStatus({ key: "readyEmpty" });
        setPct(100);
        setReady(true);
      } catch {
        setStatus({ key: stored ? "ready" : "loadFailedCache" });
        if (!stored) await load().catch(() => undefined);
        if (!cancelled) {
          setPct(100);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pullFeeds, load, applySnapshot]);

  useEffect(() => {
    if (!ready) return;
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busyRef.current || exporting) return;
      const last = data?.lastRefresh ? new Date(data.lastRefresh).getTime() : 0;
      if (Date.now() - last < 15 * 60 * 1000) return;
      void refresh();
    }, 60_000);
    return () => window.clearInterval(tick);
  }, [ready, exporting, data?.lastRefresh, refresh]);

  useEffect(() => {
    if (ready) return;
    const tick = window.setInterval(() => {
      if (realProgressRef.current) return;
      setPct((p) => (p >= 92 ? p : Math.min(92, p + 4)));
    }, 180);
    return () => window.clearInterval(tick);
  }, [ready]);

  useEffect(() => {
    if (!exporting) return;
    const tick = window.setInterval(() => {
      setPct((p) => (p >= 86 ? p : Math.min(86, p + 2)));
    }, 240);
    return () => window.clearInterval(tick);
  }, [exporting]);

  const filtered = useMemo(() => {
    const list = data?.articles ?? [];
    const query = q.trim().toLowerCase();
    return list.filter((a) => {
      if (!matchesChip(a, chip)) return false;
      if (!query) return true;
      return `${a.title} ${a.source} ${a.description}`.toLowerCase().includes(query);
    });
  }, [data, chip, q]);

  const counts = useMemo(() => {
    const list = data?.articles ?? [];
    const map: Record<Chip, number> = {
      today: 0,
      all: list.length,
      unread: 0,
      breaches: 0,
      vulns: 0,
      malware: 0,
      phishing: 0,
      apt: 0,
      patch: 0,
    };
    for (const a of list) {
      if (isToday(a.pubDate || a.fetchedAt)) map.today += 1;
      if (!a.read) map.unread += 1;
      for (const id of TOPIC_CHIPS) {
        if (matchesChip(a, id)) map[id] += 1;
      }
    }
    return map;
  }, [data]);

  async function toggleRead(article: Article) {
    await fetch("/api/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: article.id, read: !article.read }),
    });
    await load();
  }

  const agencies = data?.agencies ?? { hkcert: [], govcert: [], cybersechub: [] };
  const fileStamp = newsletterFileStamp();
  const weekly = useMemo(() => buildWeeklyBrief(data?.articles ?? [], new Date(), locale), [data, locale]);

  function applyExportLabel(label?: string) {
    if (!label) return;
    const key = EXPORT_PROGRESS_KEYS[label];
    setStatus(key ? { key } : { raw: label });
  }

  async function exportReport(kind: ExportKind) {
    if (exporting || busy) return;
    setExporting(true);
    setPct(6);
    setStatus({
      key: kind === "both" ? "exportingBoth" : kind === "pdf" ? "exportingPdf" : "exportingWord",
    });
    try {
      const result = await exportReportFormat(kind, (next, label) => {
        setPct((p) => Math.max(p, next));
        applyExportLabel(label);
      });
      if (result.status === "cancelled") {
        setStatus({ key: "exportCancelled" });
        return;
      }
      if (result.status === "error") {
        setStatus({ raw: result.message });
        return;
      }
      setPct(100);
      setExportOpen(false);
      setStatus(
        result.folder
          ? { key: "savedFilesIn", vars: { files: result.files.join(" + "), folder: result.folder } }
          : { key: "savedFiles", vars: { files: result.files.join(" + ") } },
      );
    } catch (err) {
      setStatus(
        err instanceof Error ? { key: "exportFailedDetail", vars: { message: err.message } } : { key: "exportFailed" },
      );
    } finally {
      setExporting(false);
      setTimeout(() => setPct(0), 800);
    }
  }

  async function exportWeekly() {
    if (exporting || busy) return;
    setExporting(true);
    setPct(6);
    setStatus({ key: "exportingWeekly" });
    try {
      const pdfBrief = locale === "en" ? weekly : buildWeeklyBrief(data?.articles ?? [], new Date(), "en");
      const result = await exportWeeklyBriefPdf(pdfBrief, (next, label) => {
        setPct((p) => Math.max(p, next));
        applyExportLabel(label);
      });
      if (result.status === "cancelled") {
        setStatus({ key: "exportCancelled" });
        return;
      }
      if (result.status === "error") {
        setStatus({ raw: result.message });
        return;
      }
      setPct(100);
      setStatus({ key: "savedFiles", vars: { files: result.files.join(" + ") } });
    } catch (err) {
      setStatus(
        err instanceof Error ? { key: "exportFailedDetail", vars: { message: err.message } } : { key: "exportFailed" },
      );
    } finally {
      setExporting(false);
      setTimeout(() => setPct(0), 800);
    }
  }

  const working = busy || exporting;

  async function retrySource(sourceId: string) {
    if (busyRef.current || exporting) return;
    busyRef.current = true;
    setBusy(true);
    setStatus({ key: "updating" });
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sourceId }),
        cache: "no-store",
      });
      const json = (await res.json()) as { snapshot?: Snapshot };
      if (json.snapshot) applySnapshot(json.snapshot);
      setSourceProgress((prev) =>
        prev.map((row) => (row.sourceId === sourceId ? { ...row, ok: true, pending: false, error: null } : row)),
      );
      setStatus({ key: "upToDate" });
    } catch {
      setStatus({ key: "refreshFailed" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="soc-app">
      <IntelligenceWorkspace
        articles={data?.articles ?? []}
        enrichment={data?.enrichment ?? {}}
        agencies={agencies}
        lastRefresh={data?.lastRefresh ?? null}
        sourceHealth={data?.sourceHealth ?? []}
        sourceProgress={sourceProgress}
        busy={working}
        pct={pct}
        statusText={statusText}
        failedCount={failedCount}
        syncError={"key" in status && (status.key === "refreshFailed" || status.key === "loadFailedCache")}
        onRefresh={() => void refresh()}
        onRetrySource={(id) => void retrySource(id)}
        onToggleRead={(article) => void toggleRead(article)}
        onWeekly={() => setBriefOpen(true)}
        onExport={() => setExportOpen(true)}
      />

      {briefOpen ? (
        <WeeklyBriefSheet
          brief={weekly}
          saving={exporting}
          pct={pct}
          onClose={() => setBriefOpen(false)}
          onExport={() => void exportWeekly()}
        />
      ) : null}
      {exportOpen ? (
        <div className="export-layer">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label={t("closeExport")}
            onClick={() => !exporting && setExportOpen(false)}
          />
          <div className="hud-panel export-sheet">
            <p className="hud-kicker">{t("exportKicker")}</p>
            <h2 className="hud-title mt-1">{t("exportTitle")}</h2>
            <p className="mt-2 text-[1.02rem] leading-relaxed text-[#8ea0c4]">
              {t("exportHint")}
            </p>
            {exporting ? (
              <div className="export-progress">
                <p className="export-progress-pct">{pct}%</p>
                <div className="hud-meter export-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <span style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
                </div>
              </div>
            ) : null}
            <div className="mt-4 grid gap-3">
              <a
                href={reportDownloadUrl("pdf")}
                target="_blank"
                rel="noopener"
                download={`Feedly_News_Letter_${fileStamp}.pdf`}
                onClick={(event) => {
                  if (isMobileBrowser()) {
                    setExportOpen(false);
                    setStatus({ key: "openingPdf" });
                    return;
                  }
                  event.preventDefault();
                  void exportReport("pdf");
                }}
                className={`hud-btn hud-btn-primary flex min-h-12 items-center justify-center ${exporting ? "pointer-events-none opacity-60" : ""}`}
              >
                {exporting ? `${pct}%` : t("savePdf")}
              </a>
              <a
                href={reportDownloadUrl("docx")}
                target="_blank"
                rel="noopener"
                download={`Feedly_News_Letter_${fileStamp}.doc`}
                onClick={(event) => {
                  if (isMobileBrowser()) {
                    setExportOpen(false);
                    setStatus({ key: "openingWord" });
                    return;
                  }
                  event.preventDefault();
                  void exportReport("docx");
                }}
                className={`hud-btn flex min-h-12 items-center justify-center font-bold ${exporting ? "pointer-events-none opacity-60" : ""}`}
              >
                {exporting ? `${pct}%` : t("saveWord")}
              </a>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void exportReport("both")}
                className="hud-btn save-both-desktop min-h-12 disabled:opacity-60"
              >
                {exporting ? `${pct}%` : t("saveBoth")}
              </button>
            </div>
            <p className="mt-4 text-[0.95rem] text-[#8ea0c4]">
              {t("exportHintLinks")}{" "}
              <a href={reportDownloadUrl("pdf")} target="_blank" rel="noreferrer" className="text-[#3ce7ff] underline">
                PDF
              </a>
              {" · "}
              <a href={reportDownloadUrl("docx")} target="_blank" rel="noreferrer" className="text-[#3ce7ff] underline">
                Word
              </a>
            </p>
            <button type="button" className="mt-3 w-full text-[1.02rem] text-[#8ea0c4]" onClick={() => setExportOpen(false)} disabled={exporting}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShieldMark() {
  return (
    <div className="hud-brand" aria-hidden>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3.2 19.2 6v5.3c0 4.4-2.9 8.4-7.2 9.7C7.7 19.7 4.8 15.7 4.8 11.3V6L12 3.2Z"
          stroke="#3ce7ff"
          strokeWidth="1.5"
          fill="rgba(60,231,255,0.08)"
        />
        <path d="M9.1 12.1 11 14l3.9-4.4" stroke="#2ee9c7" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function SideCard({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<Pick<Article, "title" | "url"> | AgencyItem>;
  empty: string;
}) {
  return (
    <div className="hud-panel intel-card">
      <h2 className="hud-kicker mb-4">{title}</h2>
      {items.length === 0 ? (
        <p className="text-[1.05rem] italic text-[#8ea0c4]">{empty}</p>
      ) : (
        <ol className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {items.map((it, i) => (
            <li key={`${it.url}-${i}`} className="flex gap-2">
              <span className="hud-rank">{String(i + 1).padStart(2, "0")}</span>
              <a href={it.url} target="_blank" rel="noreferrer" className="hud-link hud-side-link">
                {it.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AgencyCard({
  agencies,
  title,
}: {
  agencies: { hkcert: AgencyItem[]; govcert: AgencyItem[]; cybersechub: AgencyItem[] };
  title: string;
}) {
  const groups = [
    { title: "HKCERT", items: agencies.hkcert },
    { title: "GovCERT.HK", items: agencies.govcert },
    { title: "Cybersechub", items: agencies.cybersechub },
  ].filter((group) => group.items.length > 0);
  if (!groups.length) return null;
  return (
    <div className="hud-panel intel-card">
      <h2 className="hud-kicker mb-4">{title}</h2>
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="agency-subhead">{group.title}</h3>
            <ol className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
              {group.items.map((it, i) => (
                <li key={`${it.url}-${i}`} className="flex gap-2">
                  <span className="hud-rank">{String(i + 1).padStart(2, "0")}</span>
                  <a href={it.url} target="_blank" rel="noreferrer" className="hud-link hud-side-link">
                    {it.title}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
