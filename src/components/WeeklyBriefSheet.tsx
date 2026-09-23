"use client";

import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { weeklyBriefDownloadUrl } from "@/lib/saveReport";
import type { BriefLevel, WeeklyBrief } from "@/lib/weeklyBrief";
import WeeklyPresent from "./WeeklyPresent";

function levelClass(level: BriefLevel): string {
  if (level === "red") return "brief-level brief-level-red";
  if (level === "amber") return "brief-level brief-level-amber";
  return "brief-level brief-level-green";
}

export default function WeeklyBriefSheet({
  brief,
  saving,
  pct,
  onClose,
  onExport,
}: {
  brief: WeeklyBrief;
  saving: boolean;
  pct: number;
  onClose: () => void;
  onExport: () => void;
}) {
  const { t } = useLocale();
  const [presenting, setPresenting] = useState(false);
  const levelWord = (level: BriefLevel) =>
    level === "red" ? t("levelRed") : level === "amber" ? t("levelAmber") : t("levelGreen");

  if (presenting) {
    return <WeeklyPresent brief={brief} onClose={() => setPresenting(false)} />;
  }
  return (
    <div className="export-layer brief-layer">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={t("closeBrief")}
        onClick={() => !saving && onClose()}
      />
      <div className="hud-panel brief-sheet">
        <p className="hud-kicker">{t("briefKicker")}</p>
        <div className="brief-head">
          <h2 className="hud-title mt-1">{t("weeklyBrief")}</h2>
          <span className={levelClass(brief.overall)}>{levelWord(brief.overall)}</span>
        </div>
        <p className="brief-week">{brief.weekLabel}</p>
        <p className="brief-summary">{brief.summary}</p>
        <p className="brief-scan">{t("briefScanned", { n: brief.scanned })}</p>
        {saving ? (
          <div className="export-progress">
            <p className="export-progress-pct">{pct}%</p>
            <div className="hud-meter export-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
            </div>
          </div>
        ) : null}
        <ol className="brief-topics">
          {brief.topics.map((topic, i) => (
            <li key={`${topic.url || topic.title}-${i}`} className="brief-topic">
              <div className="brief-topic-meta">
                <span className="brief-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="brief-asset">{topic.asset}</span>
                <span className={levelClass(topic.level)}>{topic.level.toUpperCase()}</span>
              </div>
              {topic.url ? (
                <a href={topic.url} target="_blank" rel="noreferrer" className="hud-link brief-title">
                  {topic.title}
                </a>
              ) : (
                <p className="brief-title brief-title-empty">{topic.title}</p>
              )}
              <p>
                <strong>{t("briefWhy")}</strong>
                {topic.why}
              </p>
              <p>
                <strong>{t("briefAsk")}</strong>
                {topic.ask}
              </p>
              {topic.source ? (
                <p className="brief-source">
                  {topic.source}
                  {topic.related > 1 ? t("briefRelated", { n: topic.related }) : ""}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void document.documentElement.requestFullscreen?.().catch(() => undefined);
              setPresenting(true);
            }}
            className="hud-btn hud-btn-primary min-h-12 disabled:opacity-60"
          >
            {t("briefPresent")}
          </button>
          <button type="button" disabled={saving} onClick={onExport} className="hud-btn min-h-12 disabled:opacity-60">
            {saving ? `${pct}%` : t("briefSavePdf")}
          </button>
          <a
            href={weeklyBriefDownloadUrl()}
            target="_blank"
            rel="noopener"
            className="text-center text-[0.95rem] text-[#8ea0c4] underline"
          >
            {t("briefDirectPdf")}
          </a>
        </div>
        <button type="button" className="mt-3 w-full text-[1.02rem] text-[#8ea0c4]" onClick={onClose} disabled={saving}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}
