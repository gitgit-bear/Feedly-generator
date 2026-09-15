import { NextResponse } from "next/server";
import { setRead } from "@/lib/store";

export async function POST(req: Request) {
  const body = (await req.json()) as { id?: string; read?: boolean };
  if (!body.id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const cache = await setRead(body.id, Boolean(body.read));
  return NextResponse.json(cache);
}
