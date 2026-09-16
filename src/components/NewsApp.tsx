"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgencyItem, Article, CacheState } from "@/lib/types";
import { isToday, relevanceScore, top10, dedupeStories } from "@/lib/rank";
import { exportReportFormat, isMobileBrowser, reportDownloadUrl, type ExportKind } from "@/lib/saveReport";
import { newsletterFileStamp } from "@/lib/reportPayload";
import { polishGoogleNewsArticle } from "@/lib/googleNews";

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

type RefreshEvent =
  | { type: "start"; total: number }
  | { type: "progress"; done: number; total: number; source: string; ok?: boolean }
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
    if (event.type === "error") throw new Error(event.message || "Refresh failed");
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
  const [data, setData] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [chip, setChip] = useState<Chip>("today");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState("Connecting to feeds…");
  const busyRef = useRef(false);
  const realProgressRef = useRef(false);

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
    setStatus("Loading feeds…");
    const res = await fetch("/api/refresh", {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`);

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as { snapshot?: Snapshot };
      if (!json.snapshot) throw new Error("Refresh returned no data");
      applySnapshot(json.snapshot);
      realProgressRef.current = true;
      setPct(100);
      setStatus("Ready");
      return json.snapshot;
    }

    if (!res.body) throw new Error("Refresh returned no data");

    const snapshot = await readRefreshStream(res.body, (event) => {
      realProgressRef.current = true;
      if (event.type === "start") {
        setPct(4);
        setStatus(`Refreshing 0/${event.total}…`);
        return;
      }
      if (event.type === "progress") {
        const next = event.total ? Math.round((event.done / event.total) * 100) : 0;
        setPct(Math.min(99, Math.max(4, next)));
        setStatus(
          event.ok === false
            ? `Refreshing ${event.done}/${event.total} · ${event.source} failed`
            : `Refreshing ${event.done}/${event.total} · ${event.source}`,
        );
      }
    });

    applySnapshot(snapshot);
    setPct(100);
    setStatus("Ready");
    return snapshot;
  }, [applySnapshot]);

  const refresh = useCallback(async () => {
    if (!ready || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPct(0);
    setStatus("Refreshing feeds… 0%");
    realProgressRef.current = false;
    try {
      await pullFeeds();
      setStatus("Up to date");
    } catch {
      setStatus("Refresh failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setTimeout(() => setPct(0), 800);
    }
  }, [pullFeeds, ready]);

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
      setStatus("Updating…");
      setReady(true);
    }

    void (async () => {
      try {
        if (!stored) setStatus("Loading feeds…");
        const res = await fetch("/api/articles", { cache: "no-store" });
        const json = (await res.json()) as Snapshot;
        if (cancelled) return;
        if (json.articles?.length) {
          applySnapshot(json);
          setPct(100);
          setStatus("Ready");
          setReady(true);
          return;
        }
        const snap = await pullFeeds();
        if (cancelled) return;
        if (!snap.articles.length) setStatus("Ready — no headlines yet");
        setPct(100);
        setReady(true);
      } catch {
        setStatus(stored ? "Ready" : "Load failed — opening last cache");
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
    if (ready) return;
    const tick = window.setInterval(() => {
      if (realProgressRef.current) return;
      setPct((p) => (p >= 92 ? p : Math.min(92, p + 4)));
    }, 180);
    return () => window.clearInterval(tick);
  }, [ready]);

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

  if (!ready) {
    return (
      <div className="cyber-root">
        <div className="cyber-bg" />
        <div className="cyber-scan" />
        <div className="cyber-beam" />
        <div className="boot-screen">
          <div className="hud-panel boot-card">
            <div className="mx-auto mb-4 flex justify-center">
              <ShieldMark />
            </div>
            <p className="hud-kicker">SOC feed · HK</p>
            <h1 className="hud-title mt-1">CyberGuard Intelligence</h1>
            <p className="boot-pct">{Math.min(100, Math.max(0, pct))}%</p>
            <div className="boot-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
            </div>
            <p className="boot-status">{status}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-root">
      <div className="cyber-bg" />
      <div className="cyber-scan" />
      <div className="cyber-beam" />
      <div className="hud-shell">
        <header className="hud-header">
          <div className="hud-header-inner">
            <div className="hud-toolbar">
              <ShieldMark />
              <div className="min-w-0 hud-branding">
                <p className="hud-kicker">SOC feed · HK</p>
                <h1 className="hud-title">
                  CyberGuard<span className="title-rest"> Intelligence</span>
                </h1>
                <p className="hud-status mt-0.5 flex items-center gap-2">
                  <span className={busy ? "live-dot live-dot-busy" : "live-dot"} />
                  {status}
                </p>
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search headlines, CVE…"
                className="hud-input hud-search"
                enterKeyHint="search"
                autoCapitalize="off"
                autoCorrect="off"
              />
              <div className="hud-actions">
                <button type="button" onClick={() => setExportOpen(true)} disabled={exporting} className="hud-btn hud-btn-primary disabled:opacity-60">
                  {exporting ? "Exporting…" : "Export"}
                </button>
                <button type="button" onClick={() => void refresh()} disabled={busy} className="hud-btn disabled:opacity-60">
                  {busy ? `${pct}%` : "Refresh"}
                </button>
              </div>
            </div>
            <div className="hud-chips">
              {CHIPS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChip(c.id)}
                  className={chip === c.id ? "hud-chip hud-chip-on" : "hud-chip"}
                >
                  {c.label}
                  <span className="hud-chip-count">{counts[c.id]}</span>
                </button>
              ))}
              <div className="hud-meter-wrap">
                <span className="w-10 text-right text-xs font-bold text-[#3ce7ff]">{busy ? `${pct}%` : ""}</span>
                <div className="hud-meter">
                  <span style={{ width: `${busy ? pct : 0}%` }} />
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="hud-main">
          <section className="feed-col space-y-3 sm:space-y-4">
            {filtered.length === 0 ? (
              <div className="hud-panel p-8 text-center text-[#8ea0c4]">
                {busy ? "Updating today’s feeds…" : "No headlines for this filter yet."}
              </div>
            ) : (
              filtered.slice(0, 40).map((a) => (
                <article
                  key={a.id}
                  className={`hud-panel hud-card feed-card ${a.read ? "hud-card-read" : ""}`}
                  onMouseMove={(event) => tiltCard(event.currentTarget, event.clientX, event.clientY)}
                  onMouseLeave={(event) => resetTilt(event.currentTarget)}
                >
                  <div className="mb-2 flex items-center justify-between gap-3 text-[#8ea0c4]">
                    <span className="hud-badge">{a.source}</span>
                    <span className="shrink-0 text-[0.88rem]">{relative(a.pubDate || a.fetchedAt)}</span>
                  </div>
                  <a href={a.url} target="_blank" rel="noreferrer" className="hud-link">
                    {a.title}
                  </a>
                  {a.description && shouldShowDescription(a.title, a.description, a.source) ? (
                    <p className="hud-desc line-clamp-2">{a.description}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[0.95rem]">
                    <button onClick={() => void toggleRead(a)} className="min-h-11 font-medium text-[#2ee9c7] hover:underline">
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

          <aside className="intel-rail">
            <SideCard title="TOP 10 today" items={ranked} empty="Nil" />
            <AgencyCard agencies={agencies} />
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
}: {
  agencies: { hkcert: AgencyItem[]; govcert: AgencyItem[]; cybersechub: AgencyItem[] };
}) {
  const groups = [
    { title: "HKCERT", items: agencies.hkcert },
    { title: "GovCERT.HK", items: agencies.govcert },
    { title: "Cybersechub", items: agencies.cybersechub },
  ].filter((group) => group.items.length > 0);
  if (!groups.length) return null;
  return (
    <div className="hud-panel intel-card">
      <h2 className="hud-kicker mb-4">Agencies</h2>
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
