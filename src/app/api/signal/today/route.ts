/**
 * GET /api/signal/today — the paid product.
 *
 * Requires:
 *  1. valid session (wallet signature auth)
 *  2. an active access pass (any PASS_* tier; see lib/modules/access/passes.ts)
 *
 * Content protection: signal details are NEVER sent to clients without an
 * active pass. Non-entitled users get a 402 + use the free /api/signal/preview
 * teaser (consensus counts only, no action/levels/reasoning).
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
  if (!ent.signalAccess) {
    return NextResponse.json({ ok: false, error: "PAYMENT_REQUIRED", need: "ACCESS_PASS" }, { status: 402 });
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
