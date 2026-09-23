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
};

export type FeedSource = {
  id: string;
  name: string;
  url: string;
};
