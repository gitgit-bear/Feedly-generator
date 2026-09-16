export function isGoogleNewsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "news.google.com" || host.endsWith(".news.google.com");
  } catch {
    return false;
  }
}

export function isGoogleNewsLabel(source: string): boolean {
  return /^google news/i.test(source.trim());
}

export function readRssPublisher(raw: unknown, description = ""): string {
  if (typeof raw === "string") {
    const text = raw.replace(/<[^>]+>/g, "").trim();
    if (text && !/^https?:\/\//i.test(text) && !isGoogleNewsLabel(text)) return text;
  } else if (raw && typeof raw === "object") {
    const obj = raw as { _?: unknown; $?: { url?: string } };
    if (typeof obj._ === "string" && obj._.trim()) return obj._.trim();
  }
  const fromDesc = description.match(/<font[^>]*>([^<]+)<\/font>/i)?.[1]?.trim();
  if (fromDesc && !isGoogleNewsLabel(fromDesc)) return fromDesc;
  return "";
}

export function splitGooglePublisher(title: string, source: string): { title: string; source: string } {
  if (!isGoogleNewsLabel(source)) return { title, source };
  const idx = title.lastIndexOf(" - ");
  if (idx <= 0) return { title, source };
  const publisher = title.slice(idx + 3).trim();
  if (!publisher || publisher.length > 60 || /https?:\/\//i.test(publisher)) return { title, source };
  return { title: title.slice(0, idx).trim() || title, source: publisher };
}

export function stripPublisherSuffix(title: string, publisher: string): string {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() || title : title;
}

export function googleNewsToken(url: string): string | null {
  if (!isGoogleNewsUrl(url)) return null;
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\/(?:rss\/)?(?:articles|read)\/([^/?]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function decodeLocalToken(token: string): string | null {
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (token.length % 4)) % 4);
    let text = atob(padded);
    const prefix = String.fromCharCode(0x08, 0x13, 0x22);
    if (text.startsWith(prefix)) text = text.slice(prefix.length);
    const suffix = String.fromCharCode(0xd2, 0x01, 0x00);
    if (text.endsWith(suffix)) text = text.slice(0, -suffix.length);
    if (!text.length) return null;
    const len = text.charCodeAt(0);
    const extracted = len >= 0x80 ? text.slice(2, len + 1) : text.slice(1, len + 1);
    if (/^https?:\/\//i.test(extracted) && !extracted.includes("news.google.com")) return extracted;
    const found = text.match(/https?:\/\/[^\x00-\x1f]+/);
    if (found && !found[0].includes("news.google.com")) {
      return found[0].replace(/[^\x21-\x7e]+$/g, "");
    }
    return null;
  } catch {
    return null;
  }
}

export function unwrapGoogleNewsUrlLocal(url: string): string | null {
  if (!isGoogleNewsUrl(url)) return null;
  const token = googleNewsToken(url);
  if (!token) return null;
  return decodeLocalToken(token);
}

export function polishGoogleNewsArticle<T extends { title: string; source: string; url: string }>(item: T): T {
  let { title, source, url } = item;
  if (isGoogleNewsLabel(source)) {
    const next = splitGooglePublisher(title, source);
    title = next.title;
    source = next.source;
  }
  title = stripPublisherSuffix(title, source);
  const local = unwrapGoogleNewsUrlLocal(url);
  if (local) url = local;
  if (title === item.title && source === item.source && url === item.url) return item;
  return { ...item, title, source, url };
}
