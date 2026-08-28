/**
 * GET /api/signal/preview — free teaser for today's signal.
 * Reveals everything EXCEPT the action/levels: confidence gauge (blurred),
 * indicator consensus stats, generation time — enough to show the engine is
 * real without giving away the product.
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getOrCreateTodaySignal } from "@/lib/modules/analysis/signal-service";

export async function GET(req: NextRequest) {
  const limited = guard(req, "signal");
  if (limited) return limited;

  try {
    const { engine, day, createdAt } = await getOrCreateTodaySignal();

    // public-safe aggregate of factor directions (no values)
    const bullish = engine.factors.filter((f) => f.score > 0.05).length;
    const bearish = engine.factors.filter((f) => f.score < -0.05).length;
    const neutral = engine.factors.length - bullish - bearish;

    return NextResponse.json({
      ok: true,
      day,
      createdAt: createdAt.toISOString(),
      action: null, // hidden
      confidence: null, // hidden
      consensus: { bullish, bearish, neutral, total: engine.factors.length },
      indicatorsCount: engine.factors.length,
      dataQuality: engine.dataQuality,
      candlesUsed: engine.candlesUsed,
      generationMs: Math.abs(engine.generatedAt) > 1e12 ? undefined : undefined,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("INSUFFICIENT_HISTORY")) {
      return NextResponse.json({ ok: false, error: "INSUFFICIENT_HISTORY" }, { status: 503 });
    }
    console.error("[signal:preview] engine error:", msg.slice(0, 500));
    return NextResponse.json({ ok: false, error: "ENGINE_ERROR" }, { status: 500 });
  }
}
