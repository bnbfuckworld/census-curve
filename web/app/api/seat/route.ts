import { NextRequest, NextResponse } from "next/server";
import { loadSeat } from "@/lib/server/seat";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account");
  const agentId = req.nextUrl.searchParams.get("agentId");
  const snap = await loadSeat(account, agentId);
  return NextResponse.json(snap, { headers: { "cache-control": "no-store" } });
}
