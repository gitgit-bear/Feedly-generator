"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgencyItem, Article, CacheState } from "@/lib/types";
import { isToday, relevanceScore, top10 } from "@/lib/rank";
import { exportReportFormat, isMobileBrowser, reportDownloadUrl, type ExportKind } from "@/lib/saveReport";
import { newsletterFileStamp } from "@/lib/reportPayload";

type Chip = "today" | "all" | "unread" | "breaches" | "vulns";

type Snapshot = CacheState & {
  todayCount?: number;
  top10?: Article[];
};

const CHIPS: { id: Chip; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "breaches", label: "Breaches" },
  { id: "vulns", label: "Vulns" },
];

function matchesChip(a: Article, chip: Chip): boolean {
  if (chip === "all") return true;
  if (chip === "today") return isToday(a.pubDate || a.fetchedAt);
  if (chip === "unread") return !a.read;
  const blob = `${a.title} ${a.description}`.toLowerCase();
  if (chip === "breaches") return /breach|ransomware|data leak/.test(blob);
  return /cve-|vulnerab|zero-day|exploit|patch/.test(blob);
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

function relative(iso: string | null): string {
  if (!iso) return "unknown";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function NewsApp() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [chip, setChip] = useState<Chip>("today");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState("Loading cache…");

  const load = useCallback(async () => {
    const res = await fetch("/api/articles", { cache: "no-store" });
    const json = (await res.json()) as Snapshot;
    setData(json);
  }, []);

  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setPct(0);
    setStatus("Refreshing feeds… 0%");
    const res = await fetch("/api/refresh", { method: "POST" });
    if (!res.body) {
      setBusy(false);
      setStatus("Refresh failed");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const msg = JSON.parse(line.slice(6)) as {
          type: string;
          done?: number;
          total?: number;
          source?: string;
          error?: string | null;
        };
        if (msg.type === "progress" && msg.total) {
          const next = Math.round((100 * (msg.done ?? 0)) / msg.total);
          setPct(next);
          setStatus(`Refreshing… ${next}% — ${msg.source ?? ""}`);
        }
        if (msg.type === "done") {
          setPct(100);
          setStatus("Up to date");
        }
      }
    }
    await load();
    setBusy(false);
    setTimeout(() => setPct(0), 800);
  }, [busy, load]);

  useEffect(() => {
    void (async () => {
      await load();
      setStatus("Updating today’s feeds…");
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const map: Record<Chip, number> = { today: 0, all: list.length, unread: 0, breaches: 0, vulns: 0 };
    for (const a of list) {
      if (isToday(a.pubDate || a.fetchedAt)) map.today += 1;
      if (!a.read) map.unread += 1;
      if (matchesChip(a, "breaches")) map.breaches += 1;
      if (matchesChip(a, "vulns")) map.vulns += 1;
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
  const ranked = top10(data?.articles ?? []);
  const fileStamp = newsletterFileStamp();

  async function exportReport(kind: ExportKind) {
    if (exporting) return;
    setExporting(true);
    setStatus(kind === "both" ? "Exporting Word + PDF…" : `Exporting ${kind === "pdf" ? "PDF" : "Word"}…`);
    try {
      const result = await exportReportFormat(kind);
      if (result.status === "cancelled") {
        setStatus("Export cancelled");
        return;
      }
      if (result.status === "error") {
        setStatus(result.message);
        return;
      }
      setExportOpen(false);
      const where = result.folder ? ` in ${result.folder}` : "";
      setStatus(`Saved ${result.files.join(" + ")}${where}`);
    } catch (err) {
      setStatus(err instanceof Error ? `Export failed: ${err.message}` : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="cyber-root">
      <div className="cyber-bg" />
      <div className="cyber-scan" />
      <div className="cyber-beam" />
      <div className="hud-shell">
        <header className="hud-header">
          <div className="hud-header-inner">
            <div className="hud-toolbar mx-auto max-w-[1240px] px-4 py-3 sm:px-5">
              <ShieldMark />
              <div className="min-w-0">
                <p className="hud-kicker">SOC feed · HK</p>
                <h1 className="hud-title">CyberGuard Intelligence</h1>
                <p className="hud-status mt-0.5 flex items-center gap-2">
                  <span className={busy ? "live-dot live-dot-busy" : "live-dot"} />
                  {status}
                </p>
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search headlines, sources, CVE…"
                className="hud-input hud-search sm:min-w-[240px] sm:flex-1"
              />
              <div className="hud-actions">
                <button type="button" onClick={() => setExportOpen(true)} disabled={exporting} className="hud-btn hud-btn-primary disabled:opacity-60">
                  {exporting ? "Exporting…" : "Export Report"}
                </button>
                <button type="button" onClick={() => void refresh()} disabled={busy} className="hud-btn disabled:opacity-60">
                  {busy ? `Refreshing ${pct}%` : "Refresh"}
                </button>
              </div>
            </div>
            <div className="mx-auto flex max-w-[1240px] items-center gap-2 overflow-x-auto px-4 pb-3 sm:px-5">
              {CHIPS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChip(c.id)}
                  className={chip === c.id ? "hud-chip hud-chip-on" : "hud-chip"}
                >
                  {c.label}
                  <span className="ml-1 opacity-80">{counts[c.id]}</span>
                </button>
              ))}
              <div className="hud-meter-wrap ml-auto flex items-center gap-3">
                <span className="w-10 text-right text-xs font-bold text-[#3ce7ff]">{busy ? `${pct}%` : ""}</span>
                <div className="hud-meter">
                  <span style={{ width: `${busy ? pct : 0}%` }} />
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto grid max-w-[1240px] gap-6 px-4 py-7 sm:px-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-4">
            {filtered.length === 0 ? (
              <div className="hud-panel p-10 text-center text-[#8ea0c4]">
                {busy ? "Updating today’s feeds…" : "No headlines for this filter yet."}
              </div>
            ) : (
              filtered.slice(0, 40).map((a) => (
                <article
                  key={a.id}
                  className={`hud-panel hud-card p-6 pl-7 ${a.read ? "hud-card-read" : ""}`}
                  onMouseMove={(event) => tiltCard(event.currentTarget, event.clientX, event.clientY)}
                  onMouseLeave={(event) => resetTilt(event.currentTarget)}
                >
                  <div className="mb-3 flex items-center justify-between gap-3 text-[#8ea0c4]">
                    <span className="hud-badge">{a.source}</span>
                    <span className="text-[0.95rem]">{relative(a.pubDate || a.fetchedAt)}</span>
                  </div>
                  <a href={a.url} target="_blank" rel="noreferrer" className="hud-link">
                    {a.title}
                  </a>
                  {a.description ? <p className="hud-desc line-clamp-2">{a.description}</p> : null}
                  <div className="mt-4 flex items-center gap-3 text-[0.95rem]">
                    <button onClick={() => void toggleRead(a)} className="font-medium text-[#2ee9c7] hover:underline">
                      {a.read ? "Mark unread" : "Mark read"}
                    </button>
                    {relevanceScore(a) > 0.15 ? (
                      <span className="rounded-full border border-[#b39cff]/40 bg-[#b39cff]/10 px-2 py-0.5 text-[#d2c4ff]">
                        High signal
                      </span>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
            <SideCard title="TOP 10 today" items={ranked} empty="Nil" />
            <SideCard title="HKCERT" items={agencies.hkcert} empty="Nil" />
            <SideCard title="GovCERT.HK" items={agencies.govcert} empty="Nil" />
            <SideCard title="Cybersechub" items={agencies.cybersechub} empty="Nil" />
          </aside>
        </main>
      </div>

      {exportOpen ? (
        <div className="export-layer">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close export"
            onClick={() => !exporting && setExportOpen(false)}
          />
          <div className="hud-panel export-sheet">
            <p className="hud-kicker">Secure export</p>
            <h2 className="hud-title mt-1">Export report</h2>
            <p className="mt-2 text-[1.02rem] leading-relaxed text-[#8ea0c4]">
              手機：撳 Save PDF / Save Word。iPhone 開到檔後撳分享 → 儲存到檔案。Android 會入下載資料夾。
            </p>
            <div className="mt-4 grid gap-3">
              <a
                href={reportDownloadUrl("pdf")}
                target="_blank"
                rel="noopener"
                download={`Feedly_News_Letter_${fileStamp}.pdf`}
                onClick={(event) => {
                  if (isMobileBrowser()) {
                    setExportOpen(false);
                    setStatus("Opening PDF… iPhone 請撳分享 → 儲存到檔案");
                    return;
                  }
                  event.preventDefault();
                  void exportReport("pdf");
                }}
                className="hud-btn hud-btn-primary flex min-h-12 items-center justify-center"
              >
                Save PDF
              </a>
              <a
                href={reportDownloadUrl("docx")}
                target="_blank"
                rel="noopener"
                download={`Feedly_News_Letter_${fileStamp}.doc`}
                onClick={(event) => {
                  if (isMobileBrowser()) {
                    setExportOpen(false);
                    setStatus("Opening Word… Android 會入下載；iPhone 可用分享儲存");
                    return;
                  }
                  event.preventDefault();
                  void exportReport("docx");
                }}
                className="hud-btn flex min-h-12 items-center justify-center font-bold"
              >
                Save Word (.doc)
              </a>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void exportReport("both")}
                className="hud-btn save-both-desktop min-h-12 disabled:opacity-60"
              >
                {exporting ? "Exporting…" : "Save both"}
              </button>
            </div>
            <p className="mt-4 text-[0.95rem] text-[#8ea0c4]">
              如果沒有彈出分享／下載，直接開檔案：{" "}
              <a href={reportDownloadUrl("pdf")} target="_blank" rel="noreferrer" className="text-[#3ce7ff] underline">
                PDF
              </a>
              {" · "}
              <a href={reportDownloadUrl("docx")} target="_blank" rel="noreferrer" className="text-[#3ce7ff] underline">
                Word
              </a>
            </p>
            <button type="button" className="mt-3 w-full text-[1.02rem] text-[#8ea0c4]" onClick={() => setExportOpen(false)} disabled={exporting}>
              Cancel
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
    <div className="hud-panel p-5">
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
