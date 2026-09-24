export type Article = {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  sourceId: string;
  pubDate: string | null;
  fetchedAt: string;
  read: boolean;
};

export type AgencyItem = {
  title: string;
  url: string;
  source: string;
  pubDate: string | null;
};

export type SourceHealth = {
  id: string;
  name: string;
  ok: boolean;
  error?: string | null;
  count: number;
  lastSync: string | null;
  url?: string;
  pending?: boolean;
};

export type CacheState = {
  articles: Article[];
  agencies: {
    hkcert: AgencyItem[];
    govcert: AgencyItem[];
    cybersechub: AgencyItem[];
  };
  lastRefresh: string | null;
  sourceHealth?: SourceHealth[];
  /** Official CVE enrichment from CISA / FIRST / NVD — keyed by CVE ID */
  enrichment?: Record<
    string,
    {
      cve: string;
      cvss?: number;
      epss?: number;
      epssPercentile?: number;
      kev: boolean;
      kevDateAdded?: string;
      vendor?: string;
      product?: string;
      sources: string[];
    }
  >;
  persistBackend?: string;
  workspaces?: Record<
    string,
    {
      watchlist?: string[];
      analystMap?: Record<string, unknown>;
      updatedAt?: string;
    }
  >;
};

export type FeedSource = {
  id: string;
  name: string;
  url: string;
};
