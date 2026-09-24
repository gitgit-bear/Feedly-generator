"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { WATCHLIST_SUGGESTIONS, type AnalystRecord } from "@/lib/analystStore";
import { downloadText } from "@/lib/exportIntel";

export default function WatchlistManager({
  items,
  onChange,
  onClose,
  workspaceId,
  analystMap,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  onClose: () => void;
  workspaceId?: string;
  analystMap?: Record<string, AnalystRecord>;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const unused = useMemo(
    () => WATCHLIST_SUGGESTIONS.filter((item) => !items.some((x) => x.toLowerCase() === item.toLowerCase())),
    [items],
  );

  function add(value: string) {
    const next = value.trim();
    if (!next) return;
    if (items.some((item) => item.toLowerCase() === next.toLowerCase())) return;
    onChange([...items, next]);
    setDraft("");
  }

  function exportJson() {
    const payload = {
      watchlist: items,
      analystMap: analystMap ?? undefined,
      exportedAt: new Date().toISOString(),
    };
    downloadText(`cyberguard-watchlist-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result ?? "{}")) as {
          watchlist?: unknown;
          items?: unknown;
        };
        const incoming = Array.isArray(raw.watchlist)
          ? raw.watchlist
          : Array.isArray(raw.items)
            ? raw.items
            : [];
        const terms = incoming.map((item) => String(item).trim()).filter(Boolean);
        if (!terms.length) return;
        const merged = [...items];
        for (const term of terms) {
          if (!merged.some((item) => item.toLowerCase() === term.toLowerCase())) merged.push(term);
        }
        onChange(merged.slice(0, 200));
      } catch {
        /* ignore bad file */
      }
    };
    reader.readAsText(file);
  }

  async function copyWorkspaceId() {
    if (!workspaceId) return;
    try {
      await navigator.clipboard.writeText(workspaceId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* blocked */
    }
  }

  return (
    <div className="soc-modal-layer">
      <button type="button" className="soc-modal-scrim" aria-label={t("close")} onClick={onClose} />
      <div className="soc-modal" role="dialog" aria-labelledby="watch-title">
        <div className="soc-modal-head">
          <h2 id="watch-title">{t("watchlist")}</h2>
          <button type="button" className="soc-icon-btn" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </div>
        <p className="soc-muted">{t("watchHint")}</p>
        {workspaceId ? (
          <div className="soc-watch-workspace">
            <label className="soc-select-label">
              {t("workspaceId")}
              <input className="soc-input" value={workspaceId} readOnly />
            </label>
            <button type="button" className="soc-btn" onClick={() => void copyWorkspaceId()}>
              {copied ? t("copied") : t("syncWorkspace")}
            </button>
            <p className="soc-hint">{t("persistHint")}</p>
          </div>
        ) : null}
        <form
          className="soc-watch-add"
          onSubmit={(event) => {
            event.preventDefault();
            add(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("watchPlaceholder")}
            className="soc-input"
          />
          <button type="submit" className="soc-btn soc-btn-primary">
            {t("addWatch")}
          </button>
        </form>
        <div className="soc-modal-actions">
          <button type="button" className="soc-btn" onClick={exportJson}>
            {t("exportWatch")}
          </button>
          <button type="button" className="soc-btn" onClick={() => fileRef.current?.click()}>
            {t("importWatch")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importJson(file);
              event.target.value = "";
            }}
          />
        </div>
        <div className="soc-watch-list">
          {items.map((item) => (
            <button key={item} type="button" className="soc-chip soc-chip-on" onClick={() => onChange(items.filter((x) => x !== item))}>
              {item} ×
            </button>
          ))}
        </div>
        {unused.length ? (
          <div className="soc-watch-suggest">
            {unused.map((item) => (
              <button key={item} type="button" className="soc-chip" onClick={() => add(item)}>
                + {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
