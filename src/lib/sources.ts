import type { FeedSource } from "./types";

function googleNews(query: string): string {
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

export const SOURCES: FeedSource[] = [
  { id: "thn", name: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews" },
  { id: "krebs", name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/" },
  { id: "bleeping", name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/" },
  { id: "schneier", name: "Schneier on Security", url: "https://www.schneier.com/feed/atom/" },
  {
    id: "gnews",
    name: "Google News (Cyber)",
    url: googleNews(
      'cybersecurity OR ransomware OR "data breach" OR hacking OR "zero-day" OR CVE OR exploit OR malware OR phishing',
    ),
  },
  { id: "secweek", name: "SecurityWeek", url: "https://www.securityweek.com/feed/" },
  { id: "darkreading", name: "Dark Reading", url: "https://www.darkreading.com/rss.xml" },
  { id: "helpnet", name: "Help Net Security", url: "https://www.helpnetsecurity.com/feed/" },
  { id: "infosecmag", name: "InfoSecurity Magazine", url: "https://www.infosecurity-magazine.com/rss/news/" },
  { id: "cso", name: "CSO Online", url: googleNews("site:csoonline.com") },
  { id: "scmedia", name: "SC Media", url: googleNews("site:scworld.com OR site:scmagazine.com") },
  { id: "cdm", name: "Cyber Defense Magazine", url: googleNews("site:cyberdefensemagazine.com") },
  { id: "ars", name: "Ars Technica — Security", url: "https://feeds.arstechnica.com/arstechnica/security" },
  { id: "cyberwire", name: "The CyberWire", url: googleNews("site:thecyberwire.com") },
  { id: "welivesecurity", name: "WeLiveSecurity", url: "https://www.welivesecurity.com/feed/" },
  { id: "sophos", name: "Sophos / Naked Security", url: "https://nakedsecurity.sophos.com/feed/" },
  { id: "wired", name: "Wired — Security", url: "https://www.wired.com/feed/tag/security/latest/rss" },
  { id: "cisa", name: "CISA", url: "https://www.cisa.gov/news.xml" },
  { id: "nist", name: "NIST Cybersecurity Insights", url: "https://www.nist.gov/blogs/cybersecurity-insights/rss.xml" },
  { id: "zdi", name: "Zero Day Initiative", url: "https://www.zerodayinitiative.com/rss/published/" },
  { id: "sans", name: "SANS ISC Diary", url: "https://isc.sans.edu/rssfeed.xml" },
  { id: "record", name: "The Record", url: "https://therecord.media/feed/" },
  { id: "register", name: "The Register — Security", url: "https://www.theregister.com/security/headlines.rss" },
  { id: "cloudflare", name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/" },
  { id: "unit42", name: "Palo Alto Networks Unit 42", url: "https://unit42.paloaltonetworks.com/feed/" },
  { id: "cyberscoop", name: "CyberScoop", url: "https://www.cyberscoop.com/feed/" },
  { id: "malwarebytes", name: "Malwarebytes Labs", url: "https://www.malwarebytes.com/blog/feed/" },
  { id: "troyhunt", name: "Troy Hunt", url: "https://www.troyhunt.com/rss/" },
];

export const FALLBACKS: Record<string, string[]> = {
  cisa: [
    "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    "https://www.cisa.gov/uscert/ncas/current_activity.xml",
  ],
  nist: [
    "https://www.nist.gov/news-events/cybersecurity/rss.xml",
    "https://www.nist.gov/news-events/nist-rss.xml",
  ],
  welivesecurity: [
    "https://www.welivesecurity.com/en/rss/feed/",
    "https://feeds.feedburner.com/eset/blog",
  ],
};
