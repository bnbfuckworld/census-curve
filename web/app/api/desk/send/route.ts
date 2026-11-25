import { NextRequest, NextResponse } from "next/server";
import { failure } from "@/lib/copy";
import { send } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, failure: failure("bad-json") });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, failure: failure("bad-json") });
  }
  const result = await send(body as Parameters<typeof send>[0]);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
