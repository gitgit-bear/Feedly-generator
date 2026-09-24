"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocale } from "@/components/LocaleProvider";
import FeedHealthPanel from "@/components/workspace/FeedHealthPanel";
import IntelligenceDetailPanel from "@/components/workspace/IntelligenceDetailPanel";
import WatchlistManager from "@/components/workspace/WatchlistManager";
import {
  loadAnalystMap,
  loadDisabledSources,
  loadIncidents,
  loadWatchlist,
  saveAnalystMap,
  saveDisabledSources,
  saveIncidents,
  saveWatchlist,
  type AnalystRecord,
} from "@/lib/analystStore";
import { clustersToCsv, clustersToJson, downloadText } from "@/lib/exportIntel";
import {
  DEFAULT_TIME,
  EMPTY_FILTERS,
  activeFilterCount,
  clusterArticles,
  clusterMetrics,
  detectIndicator,
  filterClusters,
  formatHkClock,
  hoursAgo,
  parseIntelQuery,
  prioritizeFeed,
  uniqueProducts,
  uniqueSources,
  uniqueVendors,
  watchlistMatchDetail,
  watchlistMatches,
  type IntelCluster,
  type IntelFilters,
  type MetricId,
  type Severity,
  type SortMode,
  type TimeFilter,
} from "@/lib/intel";
import type { MessageKey } from "@/lib/i18n";
import { computeRiskScore, sortByRisk } from "@/lib/riskScore";
import type { AgencyItem, Article, SourceHealth } from "@/lib/types";

type SourceProgress = {
  sourceId: string;
  source: string;
  ok?: boolean;
  pending?: boolean;
  error?: string | null;
  count?: number;
};

type EnrichmentMap = Record<
  string,
  {
    cvss?: number;
    epss?: number;
    epssPercentile?: number;
    kev?: boolean;
    vendor?: string;
    product?: string;
  }
>;

const WORKSPACE_KEY = "cyberguard-workspace-id";

function randomWorkspaceId(len = 16): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function ensureWorkspaceId(): string {
  try {
    const existing = localStorage.getItem(WORKSPACE_KEY)?.trim() ?? "";
    if (/^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const next = randomWorkspaceId(16);
    localStorage.setItem(WORKSPACE_KEY, next);
    return next;
  } catch {
    return randomWorkspaceId(16);
  }
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

function sortClusters(clusters: IntelCluster[], mode: SortMode, watchlist: string[]): IntelCluster[] {
  if (mode === "risk") {
    return sortByRisk(prioritizeFeed(clusters, watchlist), watchlist, watchlistMatches);
  }
  if (mode === "epss") {
    return [...clusters].sort((a, b) => {
      const ea = a.epss ?? -1;
      const eb = b.epss ?? -1;
      if (eb !== ea) return eb - ea;
      return b.lastSeen.localeCompare(a.lastSeen);
    });
  }
  if (mode === "cvss") {
    return [...clusters].sort((a, b) => {
      const ca = a.cvss ?? -1;
      const cb = b.cvss ?? -1;
      if (cb !== ca) return cb - ca;
      return b.lastSeen.localeCompare(a.lastSeen);
    });
  }
  if (mode === "recent") {
    return [...clusters].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }
  if (mode === "watchlist") {
    return [...clusters].sort((a, b) => {
      const wa = watchlistMatches(a, watchlist).length;
      const wb = watchlistMatches(b, watchlist).length;
      if (wb !== wa) return wb - wa;
      return b.lastSeen.localeCompare(a.lastSeen);
    });
  }
  return prioritizeFeed(clusters, watchlist);
}

const METRIC_DEFS: Array<{ id: MetricId; label: MessageKey; tip: MessageKey }> = [
  { id: "critical", label: "metricCritical", tip: "metricTipCritical" },
  { id: "kev", label: "metricKev", tip: "metricTipKev" },
  { id: "epss", label: "metricEpss", tip: "metricTipEpss" },
  { id: "watchlist", label: "metricWatch", tip: "metricTipWatch" },
  { id: "newCve", label: "metricNew", tip: "metricTipNew" },
  { id: "exploited", label: "metricExploited", tip: "metricTipExploited" },
];

export default function IntelligenceWorkspace({
  articles,
  enrichment,
  agencies,
  lastRefresh,
  sourceHealth,
  sourceProgress,
  busy,
  pct,
  statusText,
  failedCount,
  syncError,
  onRefresh,
  onRetrySource,
  onToggleRead,
  onWeekly,
  onExport,
}: {
  articles: Article[];
  enrichment?: EnrichmentMap;
  agencies: { hkcert: AgencyItem[]; govcert: AgencyItem[]; cybersechub: AgencyItem[] };
  lastRefresh: string | null;
  sourceHealth: SourceHealth[];
  sourceProgress: SourceProgress[];
  busy: boolean;
  pct: number;
  statusText: string;
  failedCount: number;
  syncError?: boolean;
  onRefresh: () => void;
  onRetrySource: (id: string) => void;
  onToggleRead: (article: Article) => void;
  onWeekly: () => void;
  onExport: () => void;
}) {
  const { locale, setLocale, t } = useLocale();
  const searchRef = useRef<HTMLInputElement>(null);
  const syncTimer = useRef<number | null>(null);
  const skipNextSync = useRef(true);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<IntelFilters>({ ...EMPTY_FILTERS });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const [mobilePanel, setMobilePanel] = useState<"filters" | "details" | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [exportMenu, setExportMenu] = useState<"csv" | "json" | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("risk");
  const [moreId, setMoreId] = useState<string | null>(null);
  const [analystMap, setAnalystMap] = useState<Record<string, AnalystRecord>>({});
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [nextIn, setNextIn] = useState(60);
  const [workspaceId, setWorkspaceId] = useState("");

  useEffect(() => {
    setAnalystMap(loadAnalystMap());
    setWatchlist(loadWatchlist());
    setDisabled(loadDisabledSources());
    const id = ensureWorkspaceId();
    setWorkspaceId(id);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/workspace?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const remote = (await res.json()) as {
          watchlist?: string[];
          analystMap?: Record<string, AnalystRecord>;
        };
        if (cancelled) return;
        if (Array.isArray(remote.watchlist) && remote.watchlist.length) {
          const local = loadWatchlist();
          const merged = [...local];
          for (const term of remote.watchlist) {
            const next = String(term).trim();
            if (!next) continue;
            if (!merged.some((item) => item.toLowerCase() === next.toLowerCase())) merged.push(next);
          }
          setWatchlist(merged);
          saveWatchlist(merged);
        }
        if (remote.analystMap && typeof remote.analystMap === "object") {
          const local = loadAnalystMap();
          const merged = { ...remote.analystMap, ...local };
          setAnalystMap(merged);
          saveAnalystMap(merged);
        }
      } catch {
        /* offline */
      } finally {
        skipNextSync.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceId || skipNextSync.current) return;
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      void fetch(`/api/workspace?id=${encodeURIComponent(workspaceId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchlist, analystMap }),
      }).catch(() => undefined);
    }, 800);
    return () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
    };
  }, [workspaceId, watchlist, analystMap]);

  useEffect(() => {
    if (busy) {
      setNextIn(60);
      return;
    }
    const id = window.setInterval(() => {
      setNextIn((n) => (n <= 1 ? 60 : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const parsed = useMemo(() => parseIntelQuery(query), [query]);
  const mergedFilters = useMemo<IntelFilters>(
    () => ({
      ...filters,
      ...parsed.filters,
      severities: parsed.filters.severities ?? filters.severities,
    }),
    [filters, parsed.filters],
  );

  const clusters = useMemo(() => clusterArticles(articles, enrichment ?? {}), [articles, enrichment]);
  const savedIds = useMemo(
    () => new Set(Object.entries(analystMap).filter(([, row]) => row.saved).map(([id]) => id)),
    [analystMap],
  );
  const visibleBase = useMemo(
    () => clusters.filter((cluster) => !analystMap[cluster.id]?.suppressed),
    [clusters, analystMap],
  );
  const filtered = useMemo(
    () => filterClusters(visibleBase, mergedFilters, parsed.text, watchlist, savedIds),
    [visibleBase, mergedFilters, parsed.text, watchlist, savedIds],
  );
  const ordered = useMemo(() => sortClusters(filtered, sortMode, watchlist), [filtered, sortMode, watchlist]);
  const metrics = useMemo(() => clusterMetrics(visibleBase, watchlist), [visibleBase, watchlist]);
  const shown = ordered.slice(0, limit);
  const selected = ordered.find((cluster) => cluster.id === selectedId) ?? null;
  const topClusters = ordered.slice(0, 10);
  const vendors = useMemo(() => uniqueVendors(clusters), [clusters]);
  const products = useMemo(() => uniqueProducts(clusters), [clusters]);
  const sources = useMemo(() => uniqueSources(clusters), [clusters]);
  const activeCount = activeFilterCount(mergedFilters, parsed.text);
  const watchHits = selected ? watchlistMatches(selected, watchlist) : [];
  const selectedRisk = selected ? computeRiskScore(selected, watchHits) : null;
  const indicator = detectIndicator(query);
  const pendingProgress = sourceProgress.filter((row) => row.pending || row.ok == null);
  const readyProgress = sourceProgress.filter((row) => row.ok === true);
  const failedProgress = sourceProgress.filter((row) => row.ok === false);
  const effectiveFailed = !busy && sourceProgress.length ? failedProgress.length : failedCount;
  const degraded = effectiveFailed > 0 || (!!lastRefresh && hoursAgo(lastRefresh) > 20) || (!lastRefresh && !busy);

  const healthRows: SourceHealth[] = useMemo(() => {
    const byId = new Map(sourceHealth.map((row) => [row.id, row]));
    for (const row of sourceProgress) {
      const prev = byId.get(row.sourceId);
      byId.set(row.sourceId, {
        id: row.sourceId,
        name: row.source,
        ok: row.ok ?? prev?.ok ?? false,
        error: row.error ?? prev?.error,
        count: row.count ?? prev?.count ?? 0,
        lastSync: prev?.lastSync ?? lastRefresh,
        url: prev?.url,
        pending: row.pending ?? (busy && row.ok == null),
      });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [sourceHealth, sourceProgress, lastRefresh, busy]);

  const patchAnalyst = useCallback((clusterId: string, patch: Partial<AnalystRecord>) => {
    setAnalystMap((prev) => {
      const next = {
        ...prev,
        [clusterId]: {
          status: prev[clusterId]?.status ?? "new",
          saved: prev[clusterId]?.saved ?? false,
          suppressed: prev[clusterId]?.suppressed ?? false,
          assignee: prev[clusterId]?.assignee,
          ...patch,
        },
      };
      saveAnalystMap(next);
      return next;
    });
  }, []);

  function setFilter<K extends keyof IntelFilters>(key: K, value: IntelFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setLimit(60);
  }

  function toggleSeverity(sev: Severity) {
    setFilters((prev) => ({
      ...prev,
      severities: prev.severities.includes(sev) ? prev.severities.filter((item) => item !== sev) : [...prev.severities, sev],
    }));
    setLimit(60);
  }

  function clearAll() {
    setFilters({ ...EMPTY_FILTERS });
    setQuery("");
    setLimit(60);
  }

  function applyMetric(id: MetricId) {
    if (id === "critical") {
      toggleSeverity("critical");
      return;
    }
    if (id === "kev") {
      setFilter("kev", mergedFilters.kev === "yes" ? "" : "yes");
      return;
    }
    if (id === "epss") {
      setFilter("epssHigh", !mergedFilters.epssHigh);
      return;
    }
    if (id === "watchlist") {
      setFilter("watchlistOnly", !mergedFilters.watchlistOnly);
      return;
    }
    if (id === "newCve") {
      setFilter("time", "24h");
      return;
    }
    if (id === "exploited") {
      setFilter("exploitedOnly", !mergedFilters.exploitedOnly);
    }
  }

  function metricOn(id: MetricId): boolean {
    if (id === "critical") return mergedFilters.severities.includes("critical");
    if (id === "kev") return mergedFilters.kev === "yes";
    if (id === "epss") return mergedFilters.epssHigh;
    if (id === "watchlist") return mergedFilters.watchlistOnly;
    if (id === "newCve") return mergedFilters.time === "24h" && !mergedFilters.severities.length && !mergedFilters.kev && !mergedFilters.epssHigh;
    if (id === "exploited") return mergedFilters.exploitedOnly;
    return false;
  }

  function addWatchTerm(term: string) {
    const next = term.trim();
    if (!next) return;
    if (watchlist.some((item) => item.toLowerCase() === next.toLowerCase())) return;
    const items = [...watchlist, next];
    setWatchlist(items);
    saveWatchlist(items);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* blocked */
    }
  }

  function exportClusters(format: "csv" | "json", scope: "current" | "selected") {
    const rows =
      scope === "selected" && selected
        ? [selected]
        : ordered;
    if (!rows.length) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (format === "csv") {
      downloadText(`cyberguard-intel-${stamp}.csv`, clustersToCsv(rows, watchlist), "text/csv;charset=utf-8");
    } else {
      downloadText(
        `cyberguard-intel-${stamp}.json`,
        clustersToJson(rows, watchlist, analystMap),
        "application/json",
      );
    }
    setExportMenu(null);
  }

  function toggleAdvancedFilters() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches) {
      setMobilePanel((prev) => (prev === "filters" ? null : "filters"));
      return;
    }
    setAdvancedOpen((prev) => !prev);
  }

  const chips: Array<{ id: string; label: string; clear: () => void }> = [];
  if (mergedFilters.time && mergedFilters.time !== DEFAULT_TIME) {
    const key: MessageKey =
      mergedFilters.time === "1h"
        ? "time1h"
        : mergedFilters.time === "6h"
          ? "time6h"
          : mergedFilters.time === "24h"
            ? "time24h"
            : mergedFilters.time === "7d"
              ? "time7d"
              : mergedFilters.time === "30d"
                ? "time30d"
                : "timeToday";
    chips.push({ id: "time", label: t(key), clear: () => setFilter("time", DEFAULT_TIME) });
  } else if (mergedFilters.time === DEFAULT_TIME) {
    chips.push({ id: "time", label: t("time24h"), clear: () => setFilter("time", "") });
  }
  for (const sev of mergedFilters.severities) {
    const key: MessageKey =
      sev === "critical" ? "sevCritical" : sev === "high" ? "sevHigh" : sev === "medium" ? "sevMedium" : "sevLow";
    chips.push({ id: `sev-${sev}`, label: t(key), clear: () => toggleSeverity(sev) });
  }
  if (mergedFilters.kev === "yes") chips.push({ id: "kev", label: "KEV", clear: () => setFilter("kev", "") });
  if (mergedFilters.epssHigh) chips.push({ id: "epss", label: t("epssHigh"), clear: () => setFilter("epssHigh", false) });
  if (mergedFilters.vendor) chips.push({ id: "vendor", label: mergedFilters.vendor, clear: () => setFilter("vendor", "") });
  if (mergedFilters.product) chips.push({ id: "product", label: mergedFilters.product, clear: () => setFilter("product", "") });
  if (mergedFilters.source) chips.push({ id: "source", label: mergedFilters.source, clear: () => setFilter("source", "") });
  if (mergedFilters.region === "hk") chips.push({ id: "hk", label: t("regionHk"), clear: () => setFilter("region", "") });
  if (mergedFilters.region === "apac") chips.push({ id: "apac", label: t("regionApac"), clear: () => setFilter("region", "") });
  if (mergedFilters.region === "global") chips.push({ id: "global", label: t("regionGlobal"), clear: () => setFilter("region", "") });
  if (mergedFilters.topic) {
    const topicKey: MessageKey =
      mergedFilters.topic === "breaches"
        ? "chipBreaches"
        : mergedFilters.topic === "vulns"
          ? "chipVulns"
          : mergedFilters.topic === "malware"
            ? "chipMalware"
            : mergedFilters.topic === "phishing"
              ? "chipPhishing"
              : mergedFilters.topic === "apt"
                ? "chipApt"
                : "chipPatch";
    chips.push({ id: "topic", label: t(topicKey), clear: () => setFilter("topic", "") });
  }
  if (mergedFilters.watchlistOnly) chips.push({ id: "watch", label: t("watchlist"), clear: () => setFilter("watchlistOnly", false) });
  if (mergedFilters.unreadOnly) chips.push({ id: "unread", label: t("unreadOnly"), clear: () => setFilter("unreadOnly", false) });
  if (mergedFilters.savedOnly) chips.push({ id: "saved", label: t("savedOnly"), clear: () => setFilter("savedOnly", false) });
  if (mergedFilters.exploitedOnly) chips.push({ id: "exploited", label: t("filterExploited"), clear: () => setFilter("exploitedOnly", false) });
  if (parsed.text) chips.push({ id: "q", label: parsed.text, clear: () => setQuery("") });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = event.target;
      const typing = tag instanceof HTMLInputElement || tag instanceof HTMLTextAreaElement || tag instanceof HTMLSelectElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        setMobilePanel(null);
        setHealthOpen(false);
        setWatchOpen(false);
        setMoreId(null);
        setExportMenu(null);
        setAdvancedOpen(false);
        return;
      }
      if (typing) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const idx = ordered.findIndex((item) => item.id === selected?.id);
        const next = ordered[Math.min(ordered.length - 1, Math.max(0, idx + 1))];
        if (next) setSelectedId(next.id);
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const idx = ordered.findIndex((item) => item.id === selected?.id);
        const next = ordered[Math.max(0, idx <= 0 ? 0 : idx - 1)];
        if (next) setSelectedId(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, selected]);

  const showSkeleton = !articles.length && busy;
  const showSyncError = Boolean(syncError) && !articles.length;
  const showEmpty = !showSkeleton && !showSyncError && shown.length === 0;
  const showSparseHint = !busy && filtered.length > 0 && filtered.length < 3 && mergedFilters.time === "24h";

  return (
    <div className="soc-root soc-cyber">
      <div className="soc-cyber-fx" aria-hidden="true" />
      <header className="soc-header">
        <div className="soc-brand">
          <p className="soc-kicker">{t("kicker")}</p>
          <h1>
            <span className="soc-brand-mark">CyberGuard</span>
            {t("appTitleRest")}
          </h1>
        </div>
        <div className="soc-header-meta" title={t("syncTooltip")}>
          <span>{lastRefresh ? t("lastSync", { time: formatHkClock(lastRefresh) }) : t("lastSyncNever")}</span>
          <button
            type="button"
            className={`soc-live soc-live-btn ${busy ? "is-busy" : ""} ${degraded && !busy ? "is-degraded" : ""}`}
            onClick={() => setHealthOpen(true)}
            title={t("feedHealth")}
          >
            <i aria-hidden="true" />
            {busy ? `${pct}%` : degraded ? t("liveDegraded") : t("live")}
          </button>
          {!busy && effectiveFailed > 0 ? (
            <span className="soc-muted">
              {t("sourcesFailed", { failed: effectiveFailed, total: healthRows.length || "—" })}
            </span>
          ) : null}
          {!busy ? <span className="soc-muted">{t("nextRefresh", { n: nextIn })}</span> : null}
        </div>
        <div className="soc-header-actions">
          <button type="button" className="soc-btn" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
            {locale === "en" ? t("langSwitchToZh") : t("langSwitchToEn")}
          </button>
          <button type="button" className="soc-btn" onClick={() => setWatchOpen(true)}>
            {t("watchlist")}
          </button>
          <button type="button" className="soc-btn" onClick={() => setHealthOpen(true)}>
            {t("feedHealth")}
          </button>
          <button type="button" className="soc-btn" onClick={onWeekly}>
            {t("weekly")}
          </button>
          <button type="button" className="soc-btn soc-btn-primary" onClick={onExport}>
            {t("export")}
          </button>
          <div className="soc-export-menu">
            <button type="button" className="soc-btn" onClick={() => setExportMenu(exportMenu === "csv" ? null : "csv")}>
              {t("exportCsv")}
            </button>
            <button type="button" className="soc-btn" onClick={() => setExportMenu(exportMenu === "json" ? null : "json")}>
              {t("exportJson")}
            </button>
            {exportMenu ? (
              <div className="soc-export-menu-panel" role="menu">
                <button type="button" onClick={() => exportClusters(exportMenu, "current")}>
                  {t("exportCurrent")}
                </button>
                <button type="button" disabled={!selected} onClick={() => exportClusters(exportMenu, "selected")}>
                  {t("exportSelected")}
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="soc-btn" onClick={onRefresh} disabled={busy}>
            {busy ? `${pct}%` : t("refresh")}
          </button>
        </div>
      </header>

      <div className="soc-search-row">
        <input
          ref={searchRef}
          className="soc-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchIntel")}
          aria-label={t("searchIntel")}
        />
        {indicator ? <p className="soc-hint">{t("detectedAs", { type: indicator.type })}</p> : null}
      </div>

      {showSkeleton ? (
        <div className="soc-metrics">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="soc-skeleton-card" />
          ))}
        </div>
      ) : (
        <div className="soc-metrics">
          {METRIC_DEFS.map((metric) => (
            <button
              key={metric.id}
              type="button"
              className={metricOn(metric.id) ? "is-on" : ""}
              title={t(metric.tip)}
              onClick={() => applyMetric(metric.id)}
            >
              <strong>{metrics[metric.id]}</strong> {t(metric.label)}
            </button>
          ))}
        </div>
      )}

      <div className="soc-quick-filters" aria-label={t("quickFilters")}>
        <FilterGroup label={t("quickFilters")}>
          <button
            type="button"
            className={`soc-chip ${mergedFilters.severities.includes("critical") ? "soc-chip-on" : ""}`}
            onClick={() => toggleSeverity("critical")}
          >
            {t("sevCritical")}
          </button>
          <button
            type="button"
            className={`soc-chip ${mergedFilters.kev === "yes" ? "soc-chip-on" : ""}`}
            onClick={() => setFilter("kev", mergedFilters.kev === "yes" ? "" : "yes")}
          >
            {t("filterKev")}
          </button>
          <button
            type="button"
            className={`soc-chip ${mergedFilters.epssHigh ? "soc-chip-on" : ""}`}
            onClick={() => setFilter("epssHigh", !mergedFilters.epssHigh)}
          >
            {t("epssHigh")}
          </button>
          <button
            type="button"
            className={`soc-chip ${mergedFilters.watchlistOnly ? "soc-chip-on" : ""}`}
            onClick={() => setFilter("watchlistOnly", !mergedFilters.watchlistOnly)}
          >
            {t("watchlist")}
          </button>
          <button
            type="button"
            className={`soc-chip ${mergedFilters.unreadOnly ? "soc-chip-on" : ""}`}
            onClick={() => setFilter("unreadOnly", !mergedFilters.unreadOnly)}
          >
            {t("unreadOnly")}
          </button>
        </FilterGroup>
        <FilterGroup label={t("filterTime")}>
          {(["1h", "6h", "24h", "7d", "30d"] as TimeFilter[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`soc-chip ${mergedFilters.time === id ? "soc-chip-on" : ""}`}
              onClick={() => setFilter("time", mergedFilters.time === id ? DEFAULT_TIME : id)}
            >
              {t(
                id === "1h"
                  ? "time1h"
                  : id === "6h"
                    ? "time6h"
                    : id === "24h"
                      ? "time24h"
                      : id === "7d"
                        ? "time7d"
                        : "time30d",
              )}
            </button>
          ))}
        </FilterGroup>
        <label className="soc-select-label">
          {t("sortBy")}
          <select className="soc-input" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="risk">{t("sortRisk")}</option>
            <option value="epss">{t("sortEpss")}</option>
            <option value="cvss">{t("sortCvss")}</option>
            <option value="recent">{t("sortRecent")}</option>
            <option value="watchlist">{t("sortWatch")}</option>
          </select>
        </label>
        <button
          type="button"
          className={`soc-btn ${advancedOpen || mobilePanel === "filters" ? "soc-btn-primary" : ""}`}
          onClick={toggleAdvancedFilters}
        >
          {t("advancedFiltersToggle")}
        </button>
      </div>

      {chips.length ? (
        <div className="soc-active-chips">
          <span className="soc-muted">{t("activeFilters", { n: activeCount })}</span>
          {chips.map((chip) => (
            <button key={chip.id} type="button" className="soc-chip soc-chip-on" onClick={chip.clear}>
              {chip.label} ×
            </button>
          ))}
          <button type="button" className="soc-link-btn" onClick={clearAll}>
            {t("clearFilters")}
          </button>
        </div>
      ) : null}

      {showSparseHint ? (
        <div className="soc-sparse-hint">
          <span>{t("sparseFeedHint")}</span>
          <button type="button" className="soc-btn" onClick={() => setFilter("time", "7d")}>
            {t("widenTo7d")}
          </button>
        </div>
      ) : null}

      {(busy || effectiveFailed > 0) && articles.length > 0 ? (
        <div className="soc-loadbar">
          {busy ? <p>{t("showingCached")}</p> : null}
          {effectiveFailed > 0 ? (
            <p>
              {t("sourcesFailed", { failed: effectiveFailed, total: healthRows.length || "—" })}{" "}
              <button type="button" className="soc-link-btn" onClick={onRefresh}>
                {t("retry")}
              </button>
            </p>
          ) : null}
          {sourceProgress.length ? (
            <ul className="soc-source-progress">
              {readyProgress.slice(-6).map((row) => (
                <li key={row.sourceId} className="is-ok">
                  ✓ {row.source}
                </li>
              ))}
              {pendingProgress.slice(0, 3).map((row) => (
                <li key={row.sourceId} className="is-pending">
                  ⟳ {row.source}
                </li>
              ))}
              {failedProgress.slice(0, 4).map((row) => (
                <li key={row.sourceId} className="is-bad">
                  ⚠ {row.source}
                  <button type="button" onClick={() => onRetrySource(row.sourceId)}>
                    {t("retry")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {busy ? (
            <p className="soc-muted">
              {statusText} · {t("sourcesReady", { done: readyProgress.length, total: sourceProgress.length || "—" })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="soc-mobile-tabs">
        <button
          type="button"
          className={mobilePanel === "filters" ? "is-on" : ""}
          onClick={() => setMobilePanel(mobilePanel === "filters" ? null : "filters")}
        >
          {t("closeFilters")}
        </button>
        <button
          type="button"
          className={mobilePanel === "details" ? "is-on" : ""}
          onClick={() => setMobilePanel(mobilePanel === "details" ? null : "details")}
        >
          {t("closeDetails")}
        </button>
      </div>

      <div className={`soc-grid ${!advancedOpen ? "no-filters" : ""} ${mobilePanel ? `show-${mobilePanel}` : ""}`}>
        <aside className={`soc-filters ${!advancedOpen ? "is-collapsed" : ""}`}>
          <div className="soc-filter-head">
            <h2>{t("advancedFilters")}</h2>
            <span>{t("activeFilters", { n: activeCount })}</span>
          </div>
          <FilterGroup label={t("filterSeverity")}>
            {(["critical", "high", "medium", "low"] as Severity[]).map((sev) => (
              <button
                key={sev}
                type="button"
                className={`soc-chip ${mergedFilters.severities.includes(sev) ? "soc-chip-on" : ""}`}
                onClick={() => toggleSeverity(sev)}
              >
                {t(sev === "critical" ? "sevCritical" : sev === "high" ? "sevHigh" : sev === "medium" ? "sevMedium" : "sevLow")}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label={t("filterRegion")}>
            {(["", "global", "apac", "hk"] as const).map((id) => (
              <button
                key={id || "all"}
                type="button"
                className={`soc-chip ${mergedFilters.region === id ? "soc-chip-on" : ""}`}
                onClick={() => setFilter("region", id)}
              >
                {id === "hk"
                  ? t("regionHk")
                  : id === "apac"
                    ? t("regionApac")
                    : id === "global"
                      ? t("regionGlobal")
                      : t("chipAll")}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label={t("filterTopic")}>
            {(["", "breaches", "vulns", "malware", "phishing", "apt", "patch"] as const).map((id) => (
              <button
                key={id || "all"}
                type="button"
                className={`soc-chip ${mergedFilters.topic === id ? "soc-chip-on" : ""}`}
                onClick={() => setFilter("topic", id)}
              >
                {id
                  ? t(
                      id === "breaches"
                        ? "chipBreaches"
                        : id === "vulns"
                          ? "chipVulns"
                          : id === "malware"
                            ? "chipMalware"
                            : id === "phishing"
                              ? "chipPhishing"
                              : id === "apt"
                                ? "chipApt"
                                : "chipPatch",
                    )
                  : t("chipAll")}
              </button>
            ))}
          </FilterGroup>
          <label className="soc-select-label">
            {t("filterVendor")}
            <select className="soc-input" value={mergedFilters.vendor} onChange={(event) => setFilter("vendor", event.target.value)}>
              <option value="">{t("anyVendor")}</option>
              {vendors.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="soc-select-label">
            {t("filterProduct")}
            <select className="soc-input" value={mergedFilters.product} onChange={(event) => setFilter("product", event.target.value)}>
              <option value="">{t("anyProduct")}</option>
              {products.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="soc-select-label">
            {t("filterSource")}
            <select className="soc-input" value={mergedFilters.source} onChange={(event) => setFilter("source", event.target.value)}>
              <option value="">{t("anySource")}</option>
              {sources.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="soc-check">
            <input
              type="checkbox"
              checked={mergedFilters.exploitedOnly}
              onChange={(event) => setFilter("exploitedOnly", event.target.checked)}
            />
            {t("filterExploited")}
          </label>
          <label className="soc-check">
            <input
              type="checkbox"
              checked={mergedFilters.savedOnly}
              onChange={(event) => setFilter("savedOnly", event.target.checked)}
            />
            {t("savedOnly")}
          </label>
          <button type="button" className="soc-link-btn" onClick={clearAll}>
            {t("clearFilters")}
          </button>
        </aside>

        <section className="soc-feed" aria-label={t("intelFeed")}>
          {showSkeleton ? (
            <div className="soc-skeleton-list">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="soc-skeleton-card" />
              ))}
            </div>
          ) : showSyncError ? (
            <div className="soc-empty">
              <p>{t("unableRetrieve")}</p>
              <p className="soc-muted">{t("lastSuccessfulSync", { time: formatHkClock(lastRefresh) })}</p>
              <div className="soc-card-actions">
                <button type="button" className="soc-btn soc-btn-primary" onClick={onRefresh}>
                  {t("retry")}
                </button>
                <button type="button" className="soc-btn" onClick={() => setHealthOpen(true)}>
                  {t("sourceHealthLink")}
                </button>
              </div>
            </div>
          ) : showEmpty ? (
            <div className="soc-empty">
              <p>{t("emptyFiltered")}</p>
              <p className="soc-muted">{t("outsideFilters", { n: visibleBase.length })}</p>
              <div className="soc-card-actions">
                <button type="button" className="soc-btn" onClick={clearAll}>
                  {t("clearFilters")}
                </button>
                <button type="button" className="soc-btn" onClick={() => setFilter("time", "24h")}>
                  {t("view24h")}
                </button>
                <button type="button" className="soc-btn" onClick={() => setFilter("time", "7d")}>
                  {t("view7d")}
                </button>
              </div>
            </div>
          ) : (
            shown.map((cluster) => {
              const hits = watchlistMatches(cluster, watchlist);
              const rec = analystMap[cluster.id];
              const risk = computeRiskScore(cluster, hits);
              const riskTitle = risk.contributors.map((c) => `${c.label}: ${c.points}`).join(" · ");
              const metaParts: string[] = [];
              if (cluster.cvss != null) metaParts.push(`CVSS ${cluster.cvss.toFixed(1)}`);
              if (cluster.epss != null) metaParts.push(`EPSS ${(cluster.epss * 100).toFixed(0)}%`);
              if (cluster.kev) metaParts.push("KEV");
              if (hits.length) metaParts.push(t("watchlistMatch"));
              const lead = cluster.articles[0];
              return (
                <article
                  key={cluster.id}
                  className={`soc-card ${selected?.id === cluster.id ? "is-selected" : ""} ${cluster.severity === "critical" ? "is-critical" : ""} ${cluster.unread ? "is-unread" : ""}`}
                  onClick={() => {
                    setSelectedId(cluster.id);
                    setMobilePanel("details");
                    setMoreId(null);
                  }}
                >
                  <div className="soc-card-top">
                    <span className={`soc-sev soc-sev-${cluster.severity}`}>{cluster.severity.toUpperCase()}</span>
                    <span className="soc-badge soc-badge-risk" title={riskTitle || t("riskScore")}>
                      {t("riskLabel", { score: risk.score })}
                    </span>
                    {rec?.status && rec.status !== "new" ? (
                      <span className="soc-badge">
                        {t(
                          rec.status === "reviewing"
                            ? "statusReviewing"
                            : rec.status === "action"
                              ? "statusAction"
                              : rec.status === "monitoring"
                                ? "statusMonitoring"
                                : "statusClosed",
                        )}
                      </span>
                    ) : null}
                  </div>
                  {cluster.cves.length ? <p className="soc-mono soc-cve">{cluster.cves.join("  ")}</p> : null}
                  <h3>{cluster.title}</h3>
                  {metaParts.length ? <p className="soc-meta">{metaParts.join(" · ")}</p> : null}
                  <p className="soc-meta">
                    {cluster.sources[0] ?? "—"} · {relative(cluster.lastSeen, t)}
                    {hits.length ? ` · ${t("watchMatchDetail", { detail: watchlistMatchDetail(cluster, hits) })}` : ""}
                  </p>
                  <div className="soc-card-actions is-compact">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        patchAnalyst(cluster.id, { saved: !rec?.saved });
                      }}
                    >
                      {rec?.saved ? t("savedItem") : t("saveItem")}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const term = cluster.vendor || cluster.cves[0] || cluster.products[0];
                        if (term) addWatchTerm(term);
                      }}
                    >
                      {t("copyWatch")}
                    </button>
                    <button
                      type="button"
                      disabled={!cluster.cves.length}
                      onClick={(event) => {
                        event.stopPropagation();
                        void copyText(cluster.cves.join(", "));
                      }}
                    >
                      {t("copyCve")}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const unread = cluster.articles.find((a) => !a.read);
                        if (unread) onToggleRead(unread);
                        patchAnalyst(cluster.id, { status: "monitoring" });
                      }}
                    >
                      {t("markRead")}
                    </button>
                    {lead ? (
                      <a href={lead.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                        {t("openSources")}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMoreId(moreId === cluster.id ? null : cluster.id);
                      }}
                    >
                      {t("moreActions")}
                    </button>
                  </div>
                  {moreId === cluster.id ? (
                    <div className="soc-card-flags">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          patchAnalyst(cluster.id, { suppressed: true });
                          setMoreId(null);
                        }}
                      >
                        {t("suppress")}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          patchAnalyst(cluster.id, { status: "action", saved: true });
                        }}
                      >
                        {t("createIncident")}
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
          {ordered.length > shown.length ? (
            <button type="button" className="soc-btn soc-load-more" onClick={() => setLimit((n) => n + 60)}>
              {t("loadMore")}
            </button>
          ) : null}
        </section>

        {showSkeleton ? (
          <aside className="soc-detail">
            <div className="soc-skeleton-card" />
            <div className="soc-skeleton-card" />
            <div className="soc-skeleton-card" />
          </aside>
        ) : (
          <IntelligenceDetailPanel
            cluster={selected}
            relative={(iso) => relative(iso, t)}
            analyst={selected ? analystMap[selected.id] : undefined}
            watchMatches={watchHits}
            agencies={agencies}
            topClusters={topClusters}
            topSort={sortMode}
            onTopSort={setSortMode}
            risk={selectedRisk}
            onClose={() => setMobilePanel(null)}
            onAddWatchTerm={addWatchTerm}
            onAnalyst={(patch) => {
              if (selected) {
                patchAnalyst(selected.id, patch);
                if (patch.status === "closed" || patch.status === "monitoring") {
                  const unread = selected.articles.find((a) => !a.read);
                  if (unread) onToggleRead(unread);
                }
              }
            }}
            onCreateIncident={(note) => {
              if (!selected) return;
              const incidents = loadIncidents();
              saveIncidents([
                {
                  id: `${Date.now()}`,
                  clusterId: selected.id,
                  title: selected.title,
                  note,
                  createdAt: new Date().toISOString(),
                },
                ...incidents,
              ]);
              patchAnalyst(selected.id, { status: "action", saved: true });
            }}
            onOpenArticle={(article) => {
              window.open(article.url, "_blank", "noopener,noreferrer");
            }}
          />
        )}
      </div>

      <div className="soc-mobile-refresh">
        <button type="button" className="soc-btn soc-btn-primary" onClick={onRefresh} disabled={busy}>
          {busy ? `${pct}%` : t("refresh")}
        </button>
      </div>

      {healthOpen ? (
        <FeedHealthPanel
          rows={healthRows}
          disabled={disabled}
          onClose={() => setHealthOpen(false)}
          onRefresh={onRefresh}
          onRetry={onRetrySource}
          onToggle={(id, enabled) => {
            const next = enabled ? disabled.filter((item) => item !== id) : [...disabled, id];
            setDisabled(next);
            saveDisabledSources(next);
          }}
        />
      ) : null}
      {watchOpen ? (
        <WatchlistManager
          items={watchlist}
          workspaceId={workspaceId}
          analystMap={analystMap}
          onChange={(items) => {
            setWatchlist(items);
            saveWatchlist(items);
          }}
          onClose={() => setWatchOpen(false)}
        />
      ) : null}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="soc-filter-group">
      <p className="soc-kicker">{label}</p>
      <div className="soc-chip-wrap">{children}</div>
    </div>
  );
}
