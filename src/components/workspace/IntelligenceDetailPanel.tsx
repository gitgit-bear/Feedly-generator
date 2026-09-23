"use client";

import { useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import type { AnalystRecord } from "@/lib/analystStore";
import type { MessageKey } from "@/lib/i18n";
import {
  whyThisMatters,
  type AnalystStatus,
  type IntelCluster,
  type SortMode,
} from "@/lib/intel";
import type { RiskScoreResult } from "@/lib/riskScore";
import type { AgencyItem, Article } from "@/lib/types";

const STATUS_KEYS: Record<AnalystStatus, MessageKey> = {
  new: "statusNew",
  reviewing: "statusReviewing",
  action: "statusAction",
  monitoring: "statusMonitoring",
  closed: "statusClosed",
};

const SORT_OPTIONS: Array<{ id: SortMode; key: MessageKey }> = [
  { id: "risk", key: "sortRisk" },
  { id: "epss", key: "sortEpss" },
  { id: "cvss", key: "sortCvss" },
  { id: "recent", key: "sortRecent" },
  { id: "watchlist", key: "sortWatch" },
];

const HK_REASON_KEYS: Record<string, MessageKey> = {
  "source-hkcert": "hkReasonSourceHkcert",
  "source-govcert": "hkReasonSourceGovcert",
  "source-cybersechub": "hkReasonSourceCyber",
  "mentions-hk": "hkReasonMentions",
};

function displayOrMissing(value: string | number | undefined | null, missing: string): string {
  if (value == null || value === "") return missing;
  return String(value);
}

export default function IntelligenceDetailPanel({
  cluster,
  relative,
  analyst,
  watchMatches,
  agencies,
  topClusters,
  topSort,
  onTopSort,
  onAnalyst,
  onCreateIncident,
  onOpenArticle,
  onClose,
  onAddWatchTerm,
  risk,
}: {
  cluster: IntelCluster | null;
  relative: (iso: string | null) => string;
  analyst?: AnalystRecord;
  watchMatches: string[];
  agencies: { hkcert: AgencyItem[]; govcert: AgencyItem[]; cybersechub: AgencyItem[] };
  topClusters: IntelCluster[];
  topSort: SortMode;
  onTopSort: (mode: SortMode) => void;
  onAnalyst: (patch: Partial<AnalystRecord>) => void;
  onCreateIncident: (note: string) => void;
  onOpenArticle: (article: Article) => void;
  onClose?: () => void;
  onAddWatchTerm?: (term: string) => void;
  risk?: RiskScoreResult | null;
}) {
  const { t } = useLocale();
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState("");
  const reasons = useMemo(() => (cluster ? whyThisMatters(cluster, watchMatches) : []), [cluster, watchMatches]);

  async function copy(text: string, label?: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label || t("toastCopied"));
      window.setTimeout(() => setCopied(""), 1200);
    } catch {
      /* clipboard blocked */
    }
  }

  const reasonText = (key: string) => {
    if (key === "kev") return t("reasonKev");
    if (key === "public-exploit") return t("reasonPublic");
    if (key === "exploited") return t("reasonExploited");
    if (key === "high-epss") return t("reasonEpss");
    if (key === "cvss-critical") return t("reasonCvss");
    if (key === "watchlist") return t("reasonWatch", { items: watchMatches.join(", ") });
    if (key === "multi-source") return t("reasonMulti");
    if (key === "hk") return t("reasonHk");
    return key;
  };

  if (!cluster) {
    return (
      <aside className="soc-detail">
        <div className="soc-detail-head">
          <h2>{t("topThreats")}</h2>
        </div>
        <label className="soc-select-label">
          {t("sortBy")}
          <select
            className="soc-input"
            value={topSort}
            onChange={(event) => onTopSort(event.target.value as SortMode)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(opt.key)}
              </option>
            ))}
          </select>
        </label>
        {topClusters.length ? (
          <ol className="soc-side-list">
            {topClusters.slice(0, 10).map((item, i) => (
              <li key={item.id}>
                <span className="soc-mono">{String(i + 1).padStart(2, "0")}</span>
                <button type="button" className="soc-source-btn" onClick={() => onOpenArticle(item.articles[0])}>
                  <strong>{item.title}</strong>
                  <span className="soc-muted">
                    {item.cves[0] ?? item.severity.toUpperCase()}
                    {item.cvss != null ? ` · CVSS ${item.cvss.toFixed(1)}` : ""}
                    {item.epss != null ? ` · EPSS ${(item.epss * 100).toFixed(0)}%` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="soc-muted">{t("topThreatsEmpty")}</p>
        )}
        {(agencies.hkcert.length || agencies.govcert.length || agencies.cybersechub.length) ? (
          <section className="soc-detail-block">
            <h3>{t("agencies")}</h3>
            {[
              { title: "HKCERT", items: agencies.hkcert },
              { title: "GovCERT.HK", items: agencies.govcert },
              { title: "Cybersechub", items: agencies.cybersechub },
            ]
              .filter((group) => group.items.length)
              .map((group) => (
                <div key={group.title}>
                  <p className="soc-kicker">{group.title}</p>
                  <ol className="soc-side-list">
                    {group.items.map((item) => (
                      <li key={item.url}>
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
          </section>
        ) : null}
      </aside>
    );
  }

  const watchTerm = cluster.vendor || cluster.cves[0] || cluster.products[0] || "";
  const hasExploitation = cluster.kev || cluster.exploitPublic || cluster.exploited;

  return (
    <aside className="soc-detail">
      <div className="soc-detail-head">
        <h2>{t("overview")}</h2>
        {onClose ? (
          <button type="button" className="soc-icon-btn soc-mobile-only" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        ) : null}
      </div>

      <p className={`soc-sev soc-sev-${cluster.severity}`}>{cluster.severity.toUpperCase()}</p>
      <h3 className="soc-detail-title">{cluster.title}</h3>

      <dl className="soc-signal-grid">
        <div>
          <dt title={risk?.contributors.map((c) => `${c.label}: ${c.points}`).join(" · ") || t("riskMissing")}>
            {t("riskScore")}
          </dt>
          <dd className="soc-mono">{risk ? risk.score : t("notAvailable")}</dd>
        </div>
        <div>
          <dt>{t("filterSeverity")}</dt>
          <dd>{cluster.severity.toUpperCase()}</dd>
        </div>
        <div>
          <dt>CVE</dt>
          <dd className="soc-mono">{cluster.cves.join(", ") || t("notAvailable")}</dd>
        </div>
        <div>
          <dt title={t("cvssHint")}>CVSS</dt>
          <dd className="soc-mono">{displayOrMissing(cluster.cvss != null ? cluster.cvss.toFixed(1) : null, t("notAvailable"))}</dd>
        </div>
        <div>
          <dt title={t("epssHint")}>EPSS</dt>
          <dd className="soc-mono">
            {cluster.epss == null ? t("notAvailable") : `${(cluster.epss * 100).toFixed(1)}%`}
          </dd>
        </div>
        <div>
          <dt title={t("kevHint")}>CISA KEV</dt>
          <dd>{cluster.kev ? t("kevYes") : t("notAvailable")}</dd>
        </div>
        <div>
          <dt>{t("exploitationSection")}</dt>
          <dd>
            {cluster.exploited || cluster.kev
              ? t("activelyExploited")
              : cluster.exploitPublic
                ? t("publicExploit")
                : t("notAvailable")}
          </dd>
        </div>
        <div>
          <dt>{t("overview")}</dt>
          <dd>
            {t("firstSeen", { time: relative(cluster.firstSeen) })}
            <br />
            {t("updatedAgo", { time: relative(cluster.lastSeen) })}
          </dd>
        </div>
      </dl>

      {risk && risk.contributors.length ? (
        <p className="soc-hint" title={t("riskContributors")}>
          {t("riskContributors")}:{" "}
          {risk.contributors.map((c) => `${c.label} ${c.points}`).join(" · ")}
          {risk.missing.length ? ` · ${t("riskMissing")}: ${risk.missing.join(", ")}` : ""}
        </p>
      ) : null}

      {watchMatches.length ? (
        <p className="soc-watch">{t("watchMatchDetail", { detail: watchMatches.join(", ") })}</p>
      ) : null}

      {cluster.hkReasons.length ? (
        <p
          className="soc-hk"
          title={cluster.hkReasons.map((id) => t(HK_REASON_KEYS[id] ?? "reasonHk")).join(" · ")}
        >
          {t("hkRelevance")}: {t("hkHigh")}
        </p>
      ) : null}

      {reasons.length ? (
        <section className="soc-detail-block">
          <h3>{t("whyMatters")}</h3>
          <ul className="soc-why">
            {reasons.map((reason) => (
              <li key={reason}>{reasonText(reason)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="soc-detail-block">
        <h3>{t("summarySection")}</h3>
        <p>{cluster.summary || t("notAvailable")}</p>
      </section>

      <section className="soc-detail-block">
        <h3>{t("affectedProducts")}</h3>
        {cluster.vendor || cluster.products.length ? (
          <dl className="soc-signal-grid">
            <div>
              <dt>{t("filterVendor")}</dt>
              <dd>{cluster.vendor || t("notAvailable")}</dd>
            </div>
            <div>
              <dt>{t("filterProduct")}</dt>
              <dd>{cluster.products.join(", ") || t("notAvailable")}</dd>
            </div>
          </dl>
        ) : (
          <p className="soc-muted">{t("notAvailable")}</p>
        )}
        <p className="soc-hint">{t("versionsUnknown")}</p>
      </section>

      {hasExploitation ? (
        <section className="soc-detail-block">
          <h3>{t("exploitationSection")}</h3>
          <ul className="soc-why">
            {cluster.kev ? <li>{t("knownExploited")} — {t("kevStatus")}: {t("kevYes")}</li> : null}
            {cluster.exploitPublic ? <li>{t("pocAvailable")}</li> : null}
            {cluster.exploited ? <li>{t("activeExploitation")}</li> : null}
          </ul>
        </section>
      ) : null}

      <section className="soc-detail-block">
        <h3>{t("iocPanel")}</h3>
        {cluster.iocs.length ? (
          <>
            <ul className="soc-ioc-list">
              {cluster.iocs.map((ioc) => (
                <li key={`${ioc.type}-${ioc.value}`}>
                  <span className="soc-kicker">{ioc.type}</span>
                  <code>{ioc.value}</code>
                  <button type="button" className="soc-link-btn" onClick={() => void copy(ioc.value)}>
                    {t("copyIoc")}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="soc-btn"
              onClick={() => void copy(cluster.iocs.map((ioc) => ioc.value).join("\n"))}
            >
              {t("copyAllIocs")}
            </button>
          </>
        ) : (
          <p className="soc-muted">{t("noIocs")}</p>
        )}
      </section>

      <section className="soc-detail-block">
        <h3>{t("mitre")}</h3>
        {cluster.mitre.length ? (
          <ul className="soc-why">
            {cluster.mitre.map((item) => (
              <li key={item.technique}>
                {item.tactic ? `${item.tactic} · ` : ""}
                <span className="soc-mono">{item.technique}</span>
                {item.name ? ` · ${item.name}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="soc-muted">{t("noMitre")}</p>
        )}
      </section>

      <section className="soc-detail-block">
        <h3>{t("references")}</h3>
        <ul className="soc-source-list">
          {cluster.articles.map((article) => (
            <li key={article.id}>
              <a href={article.url} target="_blank" rel="noopener noreferrer" className="soc-source-btn">
                <strong>{article.source}</strong>
                <span>{article.title}</span>
                <span className="soc-muted">{relative(article.pubDate || article.fetchedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="soc-detail-block">
        <h3>{t("analystActions")}</h3>
        <div className="soc-status-row">
          {(Object.keys(STATUS_KEYS) as AnalystStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              className={`soc-chip ${analyst?.status === status ? "soc-chip-on" : ""}`}
              onClick={() => onAnalyst({ status })}
            >
              {t(STATUS_KEYS[status])}
            </button>
          ))}
        </div>
        <div className="soc-action-grid">
          {onAddWatchTerm ? (
            <button
              type="button"
              className="soc-btn"
              disabled={!watchTerm}
              onClick={() => onAddWatchTerm(watchTerm)}
            >
              {t("addToWatchlist")}
            </button>
          ) : null}
          <button type="button" className="soc-btn" onClick={() => onAnalyst({ saved: !analyst?.saved })}>
            {analyst?.saved ? t("savedItem") : t("saveItem")}
          </button>
          <button
            type="button"
            className="soc-btn"
            onClick={() => onAnalyst({ status: "monitoring" })}
          >
            {t("markReviewed")}
          </button>
          <button
            type="button"
            className="soc-btn"
            onClick={() => onAnalyst({ status: analyst?.status === "closed" ? "new" : "closed" })}
          >
            {analyst?.status === "closed" ? t("markUnread") : t("markRead")}
          </button>
          <button
            type="button"
            className="soc-btn"
            disabled={!cluster.cves.length}
            onClick={() => void copy(cluster.cves.join(", "))}
          >
            {t("copyCve")}
          </button>
          <button
            type="button"
            className="soc-btn"
            disabled={!cluster.iocs.length}
            onClick={() => void copy(cluster.iocs.map((ioc) => ioc.value).join("\n"))}
          >
            {t("copyAllIocs")}
          </button>
          <a
            className="soc-btn"
            href={cluster.articles[0]?.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("openSources")}
          </a>
          <button type="button" className="soc-btn" onClick={() => onAnalyst({ suppressed: !analyst?.suppressed })}>
            {t("suppress")}
          </button>
        </div>
        {copied ? <p className="soc-ok">{copied}</p> : null}
        <label className="soc-assign">
          {t("assign")}
          <input
            className="soc-input"
            value={analyst?.assignee ?? ""}
            onChange={(event) => onAnalyst({ assignee: event.target.value })}
          />
        </label>
        <label className="soc-assign">
          {t("createIncident")}
          <textarea
            className="soc-input soc-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("incidentNote")}
          />
        </label>
        <button
          type="button"
          className="soc-btn soc-btn-primary"
          onClick={() => {
            onCreateIncident(note);
            setNote("");
          }}
        >
          {t("incidentCreate")}
        </button>
      </section>

      <section className="soc-detail-block soc-ai-block">
        <h3>{t("aiAnalysis")}</h3>
        <p className="soc-muted">{t("aiUnavailable")}</p>
      </section>
    </aside>
  );
}
