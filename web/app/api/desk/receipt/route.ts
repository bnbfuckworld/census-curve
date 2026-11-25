import { NextRequest, NextResponse } from "next/server";
import { failure } from "@/lib/copy";
import { checkReceipt } from "@/lib/server/receipt";

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
  const result = await checkReceipt(body as { hash?: string; account?: string });
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
