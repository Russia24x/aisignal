/**
 * GET /api/signal/today — the paid product.
 *
 * Requires:
 *  1. valid session (wallet signature auth)
 *  2. platform access (5 PENGU one-time tariff)
 *  3. active day pass or subscription (1 PENGU/day)
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { getEntitlements } from "@/lib/modules/access/entitlements";
import { getOrCreateTodaySignal } from "@/lib/modules/analysis/signal-service";

export async function GET(req: NextRequest) {
  const limited = guard(req, "signal");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED", need: "AUTH" }, { status: 401 });
  }

  const ent = await getEntitlements(session.sub);
  if (!ent.platformAccess) {
    return NextResponse.json({ ok: false, error: "PAYMENT_REQUIRED", need: "PLATFORM_ACCESS" }, { status: 402 });
  }
  if (!ent.signalAccess) {
    return NextResponse.json({ ok: false, error: "PAYMENT_REQUIRED", need: "DAY_PASS" }, { status: 402 });
  }

  try {
    const { engine, day, createdAt } = await getOrCreateTodaySignal();
    return NextResponse.json({
      ok: true,
      day,
      createdAt: createdAt.toISOString(),
      signal: {
        action: engine.action,
        score: engine.score,
        confidence: engine.confidence,
        dataQuality: engine.dataQuality,
        price: engine.price,
        entryLow: engine.entryLow,
        entryHigh: engine.entryHigh,
        stopLoss: engine.stopLoss,
        takeProfit1: engine.takeProfit1,
        takeProfit2: engine.takeProfit2,
        riskReward: engine.riskReward,
        expectedRangeLow: engine.expectedRangeLow,
        expectedRangeHigh: engine.expectedRangeHigh,
        support: engine.support,
        resistance: engine.resistance,
        atr: engine.atr,
        volatility: engine.volatility,
        factors: engine.factors,
        reasoning: engine.reasoning,
        candlesUsed: engine.candlesUsed,
      },
      entitlements: ent,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("INSUFFICIENT_HISTORY")) {
      return NextResponse.json({ ok: false, error: "INSUFFICIENT_HISTORY" }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "ENGINE_ERROR" }, { status: 500 });
  }
}
