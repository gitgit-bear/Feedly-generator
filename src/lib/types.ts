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

export type CacheState = {
  articles: Article[];
  agencies: {
    hkcert: AgencyItem[];
    govcert: AgencyItem[];
    cybersechub: AgencyItem[];
  };
  lastRefresh: string | null;
};

export type FeedSource = {
  id: string;
  name: string;
  url: string;
};
