import type { AnalystStatus } from "./intel";

const ANALYST_KEY = "cyberguard-analyst-v1";
const WATCH_KEY = "cyberguard-watchlist-v1";
const INCIDENT_KEY = "cyberguard-incidents-v1";
const DISABLED_KEY = "cyberguard-disabled-sources-v1";

export type AnalystRecord = {
  status: AnalystStatus;
  saved: boolean;
  suppressed: boolean;
  assignee?: string;
};

export type IncidentRecord = {
  id: string;
  clusterId: string;
  title: string;
  note: string;
  createdAt: string;
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function loadAnalystMap(): Record<string, AnalystRecord> {
  return readJson(ANALYST_KEY, {});
}

export function saveAnalystMap(map: Record<string, AnalystRecord>) {
  writeJson(ANALYST_KEY, map);
}

export function loadWatchlist(): string[] {
  return readJson<string[]>(WATCH_KEY, []).filter((item) => item.trim());
}

export function saveWatchlist(items: string[]) {
  writeJson(WATCH_KEY, [...new Set(items.map((item) => item.trim()).filter(Boolean))]);
}

export function loadIncidents(): IncidentRecord[] {
  return readJson(INCIDENT_KEY, []);
}

export function saveIncidents(items: IncidentRecord[]) {
  writeJson(INCIDENT_KEY, items.slice(0, 200));
}

export function loadDisabledSources(): string[] {
  return readJson(DISABLED_KEY, []);
}

export function saveDisabledSources(ids: string[]) {
  writeJson(DISABLED_KEY, ids);
}

export const WATCHLIST_SUGGESTIONS = [
  "Microsoft Windows",
  "Microsoft Exchange",
  "Fortinet",
  "Palo Alto Networks",
  "Cisco",
  "VMware",
  "Ivanti",
  "Linux Kernel",
  "Chrome",
  "Citrix",
];
