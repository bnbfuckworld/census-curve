import { NextRequest, NextResponse } from "next/server";
import { failure } from "@/lib/copy";
import { quoteSeat } from "@/lib/server/seat";

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
  const result = await quoteSeat(body as Parameters<typeof quoteSeat>[0]);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
