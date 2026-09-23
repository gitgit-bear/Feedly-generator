"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import type { BriefLevel, BriefTopic, WeeklyBrief } from "@/lib/weeklyBrief";

type Slide =
  | { kind: "title" }
  | { kind: "demo"; assets: string[] }
  | { kind: "topic"; topic: BriefTopic; index: number; total: number }
  | { kind: "asks"; topics: BriefTopic[] };

function demoAssets(topics: BriefTopic[], fallback: string): string[] {
  const wanted = topics.filter((topic) => topic.assetId === "edge" || topic.assetId === "virt");
  const labels = [...new Set((wanted.length ? wanted : topics.slice(0, 1)).map((topic) => topic.asset))];
  return labels.length ? labels : [fallback];
}

export default function WeeklyPresent({
  brief,
  onClose,
}: {
  brief: WeeklyBrief;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const liveTopics = useMemo(() => brief.topics.filter((topic) => topic.url), [brief.topics]);
  const slides = useMemo<Slide[]>(
    () => [
      { kind: "title" },
      { kind: "demo", assets: demoAssets(liveTopics, t("presentMgmtConsole")) },
      ...liveTopics.map((topic, index) => ({
        kind: "topic" as const,
        topic,
        index,
        total: liveTopics.length,
      })),
      { kind: "asks", topics: liveTopics },
    ],
    [liveTopics, t],
  );
  const [page, setPage] = useState(0);
  const last = slides.length - 1;

  const go = useCallback(
    (next: number) => {
      setPage(Math.max(0, Math.min(last, next)));
    },
    [last],
  );

  const levelWord = (level: BriefLevel) =>
    level === "red" ? t("presentRed") : level === "amber" ? t("presentAmber") : t("presentGreen");

  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown" || event.key === "Enter") {
        event.preventDefault();
        go(page + 1);
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        go(page - 1);
      }
      if (event.key === "Home") {
        event.preventDefault();
        go(0);
      }
      if (event.key === "End") {
        event.preventDefault();
        go(last);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, last, onClose, page]);

  const slide = slides[page];

  return (
    <div className={`present-root present-${brief.overall}`} role="dialog" aria-modal="true" aria-label={t("presentAria")}>
      <button type="button" className="present-hit present-hit-prev" aria-label={t("presentPrev")} onClick={() => go(page - 1)} />
      <button type="button" className="present-hit present-hit-next" aria-label={t("presentNext")} onClick={() => go(page + 1)} />

      <header className="present-top">
        <p>{t("presentHeader")}</p>
        <p>
          {page + 1} / {slides.length}
        </p>
      </header>

      <div className="present-stage">
        {slide.kind === "title" ? (
          <div className="present-slide">
            <p className="present-kicker">{brief.weekLabel}</p>
            <p className={`present-light present-light-${brief.overall}`}>{levelWord(brief.overall)}</p>
            <h1 className="present-title">{brief.summary}</h1>
            <p className="present-sub">
              {t("presentSub", { stories: liveTopics.length, scanned: brief.scanned })}
            </p>
            <p className="present-say">{t("presentSayTitle")}</p>
          </div>
        ) : null}

        {slide.kind === "demo" ? (
          <div className="present-slide">
            <p className="present-kicker">{t("presentDemoKicker")}</p>
            <h1 className="present-title present-title-story">{t("presentDemoTitle")}</h1>
            <p className="present-sub">{t("presentDemoSub")}</p>
            <div className="present-demo">
              <div className="present-demo-row present-demo-bad">
                <p className="present-demo-label">{t("presentDemoRisk")}</p>
                <div className="present-flow">
                  <span>{t("presentInternet")}</span>
                  <i />
                  <span>{t("presentExposed")}</span>
                  <i />
                  <span>{t("presentFullControl")}</span>
                </div>
                <p className="present-demo-note">{t("presentApplies", { assets: slide.assets.join(" · ") })}</p>
              </div>
              <div className="present-demo-row present-demo-good">
                <p className="present-demo-label">{t("presentControl")}</p>
                <div className="present-flow">
                  <span>{t("presentInternet")}</span>
                  <i />
                  <span>{t("presentNoPort")}</span>
                  <i />
                  <span>{t("presentStaffLogin")}</span>
                </div>
                <p className="present-demo-note">{t("presentIfPort")}</p>
              </div>
            </div>
            <p className="present-say">{t("presentSayDemo")}</p>
          </div>
        ) : null}

        {slide.kind === "topic" ? (
          <div className="present-slide">
            <p className="present-kicker">
              {t("presentStoryKicker", { n: slide.index + 1, total: slide.total, asset: slide.topic.asset })}
            </p>
            <p className={`present-light present-light-${slide.topic.level}`}>{slide.topic.level.toUpperCase()}</p>
            <h1 className="present-title present-title-story">{slide.topic.title}</h1>
            <div className="present-blocks">
              <p>
                <span>{t("presentWhy")}</span>
                {slide.topic.why}
              </p>
              <p>
                <span>{t("presentAsk")}</span>
                {slide.topic.ask}
              </p>
            </div>
            <p className="present-say">{t("presentSayPrefix", { text: slide.topic.say })}</p>
          </div>
        ) : null}

        {slide.kind === "asks" ? (
          <div className="present-slide">
            <p className="present-kicker">{t("presentNeedKicker")}</p>
            <h1 className="present-title">{t("presentDecisions")}</h1>
            <ol className="present-asks">
              {slide.topics.map((topic, i) => (
                <li key={topic.url || topic.title}>
                  <strong>
                    {i + 1}. {topic.asset}
                  </strong>
                  <span>{topic.ask}</span>
                </li>
              ))}
            </ol>
            <p className="present-say">{t("presentSayEnd")}</p>
          </div>
        ) : null}
      </div>

      <footer className="present-nav">
        <button type="button" className="present-nav-btn" onClick={() => go(page - 1)} disabled={page === 0}>
          {t("presentBack")}
        </button>
        <div className="present-dots" aria-hidden>
          {slides.map((item, i) => (
            <button
              key={`${item.kind}-${i}`}
              type="button"
              className={i === page ? "present-dot present-dot-on" : "present-dot"}
              onClick={() => go(i)}
            />
          ))}
        </div>
        {page === last ? (
          <button type="button" className="present-nav-btn present-nav-end" onClick={onClose}>
            {t("presentEnd")}
          </button>
        ) : (
          <button type="button" className="present-nav-btn" onClick={() => go(page + 1)}>
            {t("presentNextBtn")}
          </button>
        )}
        <button type="button" className="present-exit" onClick={onClose}>
          {t("presentEsc")}
        </button>
      </footer>
    </div>
  );
}
