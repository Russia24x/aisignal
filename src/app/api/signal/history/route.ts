/**
 * GET /api/signal/history — public track record.
 * Real performance of past signals (wins/losses evaluated T+24h).
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSignalHistory } from "@/lib/modules/analysis/signal-service";

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 90) : 30;

  const { items, stats } = await getSignalHistory(limit);
  return NextResponse.json({ ok: true, items, stats });
}
