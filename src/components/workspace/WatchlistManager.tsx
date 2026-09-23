"use client";

import { useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { WATCHLIST_SUGGESTIONS } from "@/lib/analystStore";

export default function WatchlistManager({
  items,
  onChange,
  onClose,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState("");
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
