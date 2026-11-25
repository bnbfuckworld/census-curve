import { NextRequest, NextResponse } from "next/server";
import { loadDesk } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const payload = await loadDesk(req.nextUrl.searchParams.get("who"), req.nextUrl.searchParams.get("account"));
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
