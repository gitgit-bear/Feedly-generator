"use client";

import { useLocale } from "@/components/LocaleProvider";
import { formatHkClock, hoursAgo } from "@/lib/intel";
import type { MessageKey } from "@/lib/i18n";
import type { SourceHealth } from "@/lib/types";

type HealthStatus = "healthy" | "delayed" | "error" | "disabled";

function classify(row: SourceHealth, disabled: boolean): HealthStatus {
  if (disabled) return "disabled";
  if (row.pending) return "healthy";
  if (!row.ok) return "error";
  if (row.lastSync && hoursAgo(row.lastSync) > 30) return "delayed";
  return "healthy";
}

function statusKey(status: HealthStatus): MessageKey {
  if (status === "delayed") return "statusDelayed";
  if (status === "error") return "statusError";
  if (status === "disabled") return "statusDisabled";
  return "statusHealthy";
}

function statusClass(status: HealthStatus): string {
  if (status === "error") return "is-bad";
  if (status === "delayed") return "is-pending";
  if (status === "disabled") return "is-pending";
  return "is-ok";
}

export default function FeedHealthPanel({
  rows,
  disabled,
  onClose,
  onRefresh,
  onRetry,
  onToggle,
}: {
  rows: SourceHealth[];
  disabled: string[];
  onClose: () => void;
  onRefresh: () => void;
  onRetry: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const { t } = useLocale();
  const enabledRows = rows.filter((row) => !disabled.includes(row.id));
  const okCount = enabledRows.filter((row) => row.ok).length;
  const lastOk = rows
    .map((row) => row.lastSync)
    .filter((iso): iso is string => Boolean(iso))
    .sort()
    .at(-1) ?? null;

  return (
    <div className="soc-modal-layer">
      <button type="button" className="soc-modal-scrim" aria-label={t("close")} onClick={onClose} />
      <div className="soc-modal soc-modal-wide" role="dialog" aria-labelledby="health-title">
        <div className="soc-modal-head">
          <div>
            <p className="soc-kicker">{t("feedHealth")}</p>
            <h2 id="health-title">{t("healthTitle")}</h2>
            <p className="soc-muted">{t("sourcesHealthy", { ok: okCount, total: rows.length })}</p>
            <p className="soc-muted">{t("lastSuccessfulSync", { time: formatHkClock(lastOk) })}</p>
          </div>
          <div className="soc-modal-actions">
            <button type="button" className="soc-btn soc-btn-primary" onClick={onRefresh}>
              {t("refreshAll")}
            </button>
            <button type="button" className="soc-icon-btn" onClick={onClose} aria-label={t("close")}>
              ×
            </button>
          </div>
        </div>
        <div className="soc-health-table">
          <div className="soc-health-row soc-health-head">
            <span>{t("filterSource")}</span>
            <span>Status</span>
            <span>{t("items")}</span>
            <span />
          </div>
          {rows.map((row) => {
            const off = disabled.includes(row.id);
            const status = classify(row, off);
            return (
              <div key={row.id} className={`soc-health-row ${statusClass(status)}`}>
                <div>
                  <strong>{row.name}</strong>
                  {row.url ? (
                    <a href={row.url} target="_blank" rel="noopener noreferrer" className="soc-mini-link">
                      {t("viewFeed")}
                    </a>
                  ) : null}
                  <p className="soc-muted">{t("lastSuccessfulSync", { time: formatHkClock(row.lastSync) })}</p>
                  {!row.ok && row.error ? (
                    <p className="soc-error-text">
                      {t("lastError")}: {row.error}
                    </p>
                  ) : null}
                </div>
                <span className="soc-health-status" title={t(statusKey(status))}>
                  <i aria-hidden="true" />
                  <span>{t(statusKey(status))}</span>
                </span>
                <span className="soc-mono">{row.count || "—"}</span>
                <div className="soc-health-actions">
                  <button type="button" className="soc-btn" onClick={() => onRetry(row.id)} disabled={off}>
                    {t("retry")}
                  </button>
                  <button type="button" className="soc-btn" onClick={() => onToggle(row.id, off)}>
                    {off ? t("enable") : t("disable")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
