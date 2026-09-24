import { NextResponse } from "next/server";
import { loadCache, saveCache } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspacePayload = {
  watchlist?: string[];
  analystMap?: Record<string, unknown>;
  updatedAt?: string;
};

const memory = new Map<string, WorkspacePayload>();

function keyOk(id: string): boolean {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!keyOk(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const hit = memory.get(id);
  if (hit) return NextResponse.json(hit);
  // Prefer embedding in main cache for durability when persist is configured
  const cache = await loadCache();
  const embedded = (cache as CacheStateWithWorkspace).workspaces?.[id];
  if (embedded) {
    memory.set(id, embedded);
    return NextResponse.json(embedded);
  }
  return NextResponse.json({ watchlist: [], analystMap: {}, updatedAt: null });
}

export async function PUT(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!keyOk(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  let body: WorkspacePayload;
  try {
    body = (await req.json()) as WorkspacePayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const payload: WorkspacePayload = {
    watchlist: Array.isArray(body.watchlist)
      ? [...new Set(body.watchlist.map((item) => String(item).trim()).filter(Boolean))].slice(0, 200)
      : [],
    analystMap: body.analystMap && typeof body.analystMap === "object" ? body.analystMap : {},
    updatedAt: new Date().toISOString(),
  };
  memory.set(id, payload);
  try {
    const cache = await loadCache();
    const next = cache as CacheStateWithWorkspace;
    next.workspaces = { ...(next.workspaces ?? {}), [id]: payload };
    await saveCache(next);
  } catch {
    /* memory still holds */
  }
  return NextResponse.json(payload);
}

type CacheStateWithWorkspace = Awaited<ReturnType<typeof loadCache>> & {
  workspaces?: Record<string, WorkspacePayload>;
};
