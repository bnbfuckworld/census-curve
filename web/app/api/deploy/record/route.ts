import { NextRequest, NextResponse } from "next/server";
import { recordDeployment } from "@/lib/server/record";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    factory?: string;
    deployTx?: string;
    createTx?: string;
  } | null;
  const result = await recordDeployment(body ?? {});
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
}
