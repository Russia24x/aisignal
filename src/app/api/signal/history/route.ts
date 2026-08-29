/**
 * GET /api/signal/history — public track record.
 * Real performance of past signals (wins/losses evaluated T+24h).
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSignalHistory } from "@/lib/modules/analysis/signal-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("signal:history");

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  // clamp + integer-validate paging params (same treatment for both)
  const limitParam = Math.trunc(Number(req.nextUrl.searchParams.get("limit") ?? "30"));
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 90) : 30;
  const offsetParam = Math.trunc(Number(req.nextUrl.searchParams.get("offset") ?? "0"));
  const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

  try {
    const { items, stats, total, curve } = await getSignalHistory(limit, offset);
    return NextResponse.json({ ok: true, items, stats, total, curve });
  } catch (err) {
    // deterministic recompute can still fail on upstream candle outages —
    // answer with a JSON error like every sibling route (never a bare 500)
    log.error("history recompute failed", { err: String(err) });
    return NextResponse.json({ ok: false, error: "HISTORY_UNAVAILABLE" }, { status: 503 });
  }
}
