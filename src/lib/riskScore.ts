import type { IntelCluster } from "./intel";

function hoursAgo(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}

/** Tunable weights — must sum conceptually to 1.0 when all factors present. */
export const RISK_WEIGHTS = {
  cvss: 0.3,
  epss: 0.25,
  kev: 0.25,
  watchlist: 0.15,
  recency: 0.05,
} as const;

export type RiskContributor =
  | { id: "cvss"; label: string; points: number; detail: string }
  | { id: "epss"; label: string; points: number; detail: string }
  | { id: "kev"; label: string; points: number; detail: string }
  | { id: "watchlist"; label: string; points: number; detail: string }
  | { id: "recency"; label: string; points: number; detail: string }
  | { id: "unavailable"; label: string; points: 0; detail: string };

export type RiskScoreResult = {
  score: number;
  contributors: RiskContributor[];
  missing: string[];
};

function recencyFactor(iso: string): number {
  const h = hoursAgo(iso);
  if (!Number.isFinite(h)) return 0;
  if (h <= 6) return 1;
  if (h <= 24) return 0.75;
  if (h <= 72) return 0.45;
  if (h <= 168) return 0.25;
  return 0.1;
}

/**
 * CyberGuard Risk Score 0–100.
 * Missing factors are omitted and remaining weights are renormalized — never invents values.
 */
export function computeRiskScore(cluster: IntelCluster, watchMatches: string[]): RiskScoreResult {
  const parts: Array<{ id: RiskContributor["id"]; weight: number; factor: number; detail: string; label: string }> = [];
  const missing: string[] = [];

  if (cluster.cvss != null) {
    parts.push({
      id: "cvss",
      weight: RISK_WEIGHTS.cvss,
      factor: Math.min(1, Math.max(0, cluster.cvss / 10)),
      detail: `CVSS ${cluster.cvss.toFixed(1)}`,
      label: "CVSS",
    });
  } else {
    missing.push("CVSS");
  }

  if (cluster.epss != null) {
    parts.push({
      id: "epss",
      weight: RISK_WEIGHTS.epss,
      factor: Math.min(1, Math.max(0, cluster.epss)),
      detail: `EPSS ${(cluster.epss * 100).toFixed(0)}%`,
      label: "EPSS",
    });
  } else {
    missing.push("EPSS");
  }

  if (cluster.kev || cluster.kevMentioned) {
    parts.push({
      id: "kev",
      weight: RISK_WEIGHTS.kev,
      factor: 1,
      detail: "CISA KEV",
      label: "CISA KEV",
    });
  } else if (cluster.exploited) {
    parts.push({
      id: "kev",
      weight: RISK_WEIGHTS.kev * 0.7,
      factor: 1,
      detail: "Active exploitation reported",
      label: "Exploitation",
    });
  } else {
    missing.push("CISA KEV");
  }

  if (watchMatches.length) {
    parts.push({
      id: "watchlist",
      weight: RISK_WEIGHTS.watchlist,
      factor: 1,
      detail: `Watchlist: ${watchMatches.join(", ")}`,
      label: "Watchlist",
    });
  } else {
    missing.push("Watchlist");
  }

  parts.push({
    id: "recency",
    weight: RISK_WEIGHTS.recency,
    factor: recencyFactor(cluster.lastSeen),
    detail: `Published / updated signal`,
    label: "Recency",
  });

  const weightSum = parts.reduce((n, p) => n + p.weight, 0) || 1;
  const contributors: RiskContributor[] = parts.map((p) => {
    const points = Math.round(((p.weight / weightSum) * p.factor) * 100);
    if (p.id === "cvss") return { id: "cvss" as const, label: p.label, points, detail: p.detail };
    if (p.id === "epss") return { id: "epss" as const, label: p.label, points, detail: p.detail };
    if (p.id === "kev") return { id: "kev" as const, label: p.label, points, detail: p.detail };
    if (p.id === "watchlist") return { id: "watchlist" as const, label: p.label, points, detail: p.detail };
    if (p.id === "recency") return { id: "recency" as const, label: p.label, points, detail: p.detail };
    return { id: "unavailable" as const, label: p.label, points: 0 as const, detail: p.detail };
  });

  const raw = parts.reduce((n, p) => n + (p.weight / weightSum) * p.factor, 0);
  const score = Math.round(Math.min(100, Math.max(0, raw * 100)));

  return { score, contributors, missing };
}

export function sortByRisk(
  clusters: IntelCluster[],
  watchlist: string[],
  watchlistMatchesFn: (cluster: IntelCluster, watchlist: string[]) => string[],
): IntelCluster[] {
  return [...clusters].sort((a, b) => {
    const sa = computeRiskScore(a, watchlistMatchesFn(a, watchlist)).score;
    const sb = computeRiskScore(b, watchlistMatchesFn(b, watchlist)).score;
    if (sb !== sa) return sb - sa;
    return b.lastSeen.localeCompare(a.lastSeen);
  });
}
