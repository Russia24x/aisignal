/**
 * GET /api/signal/today — the paid product (live multi-timeframe signal).
 *
 * Requires:
 *  1. valid session (wallet signature auth)
 *  2. an active access pass (any PASS_* tier; see lib/modules/access/passes.ts)
 *
 * Content protection: signal details are NEVER sent to clients without an
 * active pass. Non-entitled users get a 402 + use the free /api/signal/preview
 * teaser (consensus counts + timeframe dots only, no scores/levels/reasoning).
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { entitlementsFromSession } from "@/lib/modules/access/entitlements";
import { getCurrentSignal, todayKey } from "@/lib/modules/analysis/signal-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = guard(req, "signal");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED", need: "AUTH" }, { status: 401 });
  }

  const ent = entitlementsFromSession(session);
  if (!ent.signalAccess) {
    return NextResponse.json({ ok: false, error: "PAYMENT_REQUIRED", need: "ACCESS_PASS" }, { status: 402 });
  }

  try {
    const engine = await getCurrentSignal();
    return NextResponse.json({
      ok: true,
      day: todayKey(),
      createdAt: new Date(engine.generatedAt).toISOString(),
      signal: {
        action: engine.action,
        band: engine.band,
        score: engine.score,
        confidence: engine.confidence,
        dataQuality: engine.dataQuality,
        price: engine.price,
        timeframes: engine.timeframes,
        entryLow: engine.entryLow,
        entryHigh: engine.entryHigh,
        stopLoss: engine.stopLoss,
        takeProfit1: engine.takeProfit1,
        takeProfit2: engine.takeProfit2,
        riskReward: engine.riskReward,
        expectedRangeLow: engine.expectedRangeLow,
        expectedRangeHigh: engine.expectedRangeHigh,
        volatilityWarning: engine.volatilityWarning,
        volatility: engine.volatility,
        factors: engine.timeframes["4h"].factors,
        reasoning: engine.reasoning,
        candlesUsed: engine.timeframes["4h"].candlesUsed,
      },
      entitlements: ent,
      // the PAID product — explicit no-store so a shared CDN/proxy can
      // never cache a per-user paid payload (belt & suspenders on top of
      // `dynamic = "force-dynamic"`)
    }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("INSUFFICIENT_HISTORY")) {
      return NextResponse.json({ ok: false, error: "INSUFFICIENT_HISTORY" }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "ENGINE_ERROR" }, { status: 500 });
  }
}
