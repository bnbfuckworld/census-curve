import { NextRequest, NextResponse } from "next/server";
import { failure } from "@/lib/copy";
import { checkSeatReceipt } from "@/lib/server/seat";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, failure: failure("bad-json") });
  }
  const hash = body && typeof body === "object" && "hash" in body ? String((body as { hash?: unknown }).hash ?? "") : "";
  const result = await checkSeatReceipt(hash);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
