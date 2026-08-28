/**
 * GET /api/signal/detail?day=YYYY-MM-DD — public drill-down into one PAST
 * day's signal (from the track record). Returns the full stored engine
 * output for that day: factor breakdown, levels and localized reasoning.
 *
 * Paywall rule (same as /api/signal/history): today's (or future) day keys
 * are rejected with 403 — the current day's signal is the paid product
 * and is only served by /api/signal/today to pass holders.
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSignalDetail } from "@/lib/modules/analysis/signal-service";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  const day = req.nextUrl.searchParams.get("day") ?? "";
  if (!DAY_RE.test(day) || Number.isNaN(Date.parse(day))) {
    return NextResponse.json({ ok: false, error: "INVALID_DAY" }, { status: 400 });
  }

  const result = await getSignalDetail(day);
  if (!result.ok) {
    const status = result.code === "TODAY_PAYWALLED" ? 403 : 404;
    return NextResponse.json({ ok: false, error: result.code }, { status });
  }

  return NextResponse.json(
    { ok: true, signal: result.signal },
    { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" } },
  );
}
