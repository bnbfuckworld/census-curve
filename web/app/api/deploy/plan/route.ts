import { NextResponse } from "next/server";
import { failure } from "@/lib/copy";
import { loadPlanAndBook } from "@/lib/server/plan";

export const dynamic = "force-dynamic";

export function GET() {
  const loaded = loadPlanAndBook();
  if (!loaded) {
    return NextResponse.json(
      { ok: false, failure: failure("page-broke") },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json({ ok: true, plan: loaded.plan, book: loaded.book }, { headers: { "cache-control": "no-store" } });
}
