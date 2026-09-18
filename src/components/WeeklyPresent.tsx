"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BriefLevel, BriefTopic, WeeklyBrief } from "@/lib/weeklyBrief";

function levelWord(level: BriefLevel): string {
  if (level === "red") return "RED · ACTION THIS WEEK";
  if (level === "amber") return "AMBER · DECIDE THIS WEEK";
  return "GREEN · AWARENESS ONLY";
}

type Slide =
  | { kind: "title" }
  | { kind: "demo"; assets: string[] }
  | { kind: "topic"; topic: BriefTopic; index: number; total: number }
  | { kind: "asks"; topics: BriefTopic[] };

function demoAssets(topics: BriefTopic[]): string[] {
  const wanted = topics.filter((topic) => topic.assetId === "edge" || topic.assetId === "virt");
  const labels = [...new Set((wanted.length ? wanted : topics.slice(0, 1)).map((topic) => topic.asset))];
  return labels.length ? labels : ["Management console"];
}

export default function WeeklyPresent({
  brief,
  onClose,
}: {
  brief: WeeklyBrief;
  onClose: () => void;
}) {
  const liveTopics = useMemo(() => brief.topics.filter((topic) => topic.url), [brief.topics]);
  const slides = useMemo<Slide[]>(
    () => [
      { kind: "title" },
      { kind: "demo", assets: demoAssets(liveTopics) },
      ...liveTopics.map((topic, index) => ({
        kind: "topic" as const,
        topic,
        index,
        total: liveTopics.length,
      })),
      { kind: "asks", topics: liveTopics },
    ],
    [liveTopics],
  );
  const [page, setPage] = useState(0);
  const last = slides.length - 1;

  const go = useCallback(
    (next: number) => {
      setPage(Math.max(0, Math.min(last, next)));
    },
    [last],
  );

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
    <div className={`present-root present-${brief.overall}`} role="dialog" aria-modal="true" aria-label="Weekly management presentation">
      <button type="button" className="present-hit present-hit-prev" aria-label="Previous slide" onClick={() => go(page - 1)} />
      <button type="button" className="present-hit present-hit-next" aria-label="Next slide" onClick={() => go(page + 1)} />

      <header className="present-top">
        <p>CyberGuard · Weekly management brief</p>
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
              {liveTopics.length} stories · {brief.scanned} unique headlines scanned · 10 minutes
            </p>
            <p className="present-say">Say this: we read hundreds of stories. You get three. Red means a decision before we leave.</p>
          </div>
        ) : null}

        {slide.kind === "demo" ? (
          <div className="present-slide">
            <p className="present-kicker">Safe demonstration · no exploit</p>
            <h1 className="present-title present-title-story">What unauthenticated access means</h1>
            <p className="present-sub">No phishing. No stolen password. If the management port is on the internet, the box can answer anyway.</p>
            <div className="present-demo">
              <div className="present-demo-row present-demo-bad">
                <p className="present-demo-label">This week’s risk</p>
                <div className="present-flow">
                  <span>Internet</span>
                  <i />
                  <span>Exposed admin port</span>
                  <i />
                  <span>Full control</span>
                </div>
                <p className="present-demo-note">Applies this week to: {slide.assets.join(" · ")}</p>
              </div>
              <div className="present-demo-row present-demo-good">
                <p className="present-demo-label">The control we want</p>
                <div className="present-flow">
                  <span>Internet</span>
                  <i />
                  <span>No admin port outside</span>
                  <i />
                  <span>Staff must log in inside</span>
                </div>
                <p className="present-demo-note">If the port is not on the internet, these stories are monitoring — not an emergency meeting.</p>
              </div>
            </div>
            <p className="present-say">Say this: we are not showing an attack. We are showing why an internet-facing management port is the whole issue.</p>
          </div>
        ) : null}

        {slide.kind === "topic" ? (
          <div className="present-slide">
            <p className="present-kicker">
              Story {slide.index + 1} of {slide.total} · {slide.topic.asset}
            </p>
            <p className={`present-light present-light-${slide.topic.level}`}>{slide.topic.level.toUpperCase()}</p>
            <h1 className="present-title present-title-story">{slide.topic.title}</h1>
            <div className="present-blocks">
              <p>
                <span>Why it matters</span>
                {slide.topic.why}
              </p>
              <p>
                <span>Ask</span>
                {slide.topic.ask}
              </p>
            </div>
            <p className="present-say">Say this: {slide.topic.say}</p>
          </div>
        ) : null}

        {slide.kind === "asks" ? (
          <div className="present-slide">
            <p className="present-kicker">What we need before we leave</p>
            <h1 className="present-title">Three decisions</h1>
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
            <p className="present-say">Say this: yes, no, or a named owner. Then we stop.</p>
          </div>
        ) : null}
      </div>

      <footer className="present-nav">
        <button type="button" className="present-nav-btn" onClick={() => go(page - 1)} disabled={page === 0}>
          Back
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
            End
          </button>
        ) : (
          <button type="button" className="present-nav-btn" onClick={() => go(page + 1)}>
            Next
          </button>
        )}
        <button type="button" className="present-exit" onClick={onClose}>
          Esc
        </button>
      </footer>
    </div>
  );
}
