import { put, list } from "@vercel/blob";
import type { CacheState } from "./types";

const BLOB_PATH = "cyberguard/cache.json";
const REDIS_KEY = "cyberguard:cache";

type PersistMeta = { backend: "memory" | "tmp" | "blob" | "upstash" };

let memoryRaw: string | null = null;

async function loadUpstash(): Promise<CacheState | null> {
  const base = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!base || !token) return null;
  try {
    const res = await fetch(base.replace(/\/$/, ""), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["GET", REDIS_KEY]),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string | null };
    if (!json.result) return null;
    return JSON.parse(json.result) as CacheState;
  } catch {
    return null;
  }
}

async function saveUpstash(state: CacheState): Promise<boolean> {
  const base = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!base || !token) return false;
  try {
    const res = await fetch(base.replace(/\/$/, ""), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", REDIS_KEY, JSON.stringify(state)]),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadBlob(): Promise<CacheState | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const listed = await list({ prefix: BLOB_PATH, limit: 1 });
    const hit = listed.blobs.find((b) => b.pathname === BLOB_PATH) ?? listed.blobs[0];
    if (!hit?.url) return null;
    const res = await fetch(hit.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as CacheState;
  } catch {
    return null;
  }
}

async function saveBlob(state: CacheState): Promise<boolean> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
  try {
    await put(BLOB_PATH, JSON.stringify(state), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadPersistentCache(): Promise<{ state: CacheState | null; meta: PersistMeta }> {
  if (memoryRaw) {
    try {
      return { state: JSON.parse(memoryRaw) as CacheState, meta: { backend: "memory" } };
    } catch {
      memoryRaw = null;
    }
  }
  const upstash = await loadUpstash();
  if (upstash) {
    memoryRaw = JSON.stringify(upstash);
    return { state: upstash, meta: { backend: "upstash" } };
  }
  const blob = await loadBlob();
  if (blob) {
    memoryRaw = JSON.stringify(blob);
    return { state: blob, meta: { backend: "blob" } };
  }
  return { state: null, meta: { backend: "tmp" } };
}

export async function savePersistentCache(state: CacheState): Promise<PersistMeta> {
  memoryRaw = JSON.stringify(state);
  if (await saveUpstash(state)) return { backend: "upstash" };
  if (await saveBlob(state)) return { backend: "blob" };
  return { backend: "memory" };
}

export function persistConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}
