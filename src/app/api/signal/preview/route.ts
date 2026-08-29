/**
 * GET /api/signal/preview — free teaser for the live signal.
 * Reveals everything EXCEPT scores/levels/reasoning: indicator consensus
 * counts + per-timeframe action dots — enough to show the engine is real
 * without giving away the product.
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getPreview } from "@/lib/modules/analysis/signal-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("signal:preview");

export async function GET(req: NextRequest) {
  const limited = guard(req, "signal");
  if (limited) return limited;

  try {
    const preview = await getPreview();
    return NextResponse.json({
      ok: true,
      day: preview.day,
      createdAt: new Date(preview.updatedAt).toISOString(),
      action: null, // hidden
      confidence: null, // hidden
      consensus: preview.consensus,
      timeframes: preview.timeframes,
      indicatorsCount: preview.indicatorsCount,
      dataQuality: preview.dataQuality,
      candlesUsed: preview.candlesUsed,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("INSUFFICIENT_HISTORY")) {
      return NextResponse.json({ ok: false, error: "INSUFFICIENT_HISTORY" }, { status: 503 });
    }
    log.error("engine error", { err: msg.slice(0, 500) });
    return NextResponse.json({ ok: false, error: "ENGINE_ERROR" }, { status: 500 });
  }
}
