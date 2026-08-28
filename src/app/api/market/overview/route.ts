/**
 * GET /api/market/overview — public live market snapshot + recent candles.
 * Free tier: gives everyone real data (transparency builds trust).
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSnapshot, getHistory } from "@/lib/modules/market/service";
import { publicConfig } from "@/lib/config";
import { getSignalHistory } from "@/lib/modules/analysis/signal-service";

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  try {
    // snapshot first — it's the critical live layer
    const snapshot = await getSnapshot();
    // history is optional for the overview (chart may degrade gracefully)
    let daily: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
    let hourly: typeof daily = [];
    try {
      const history = await getHistory();
      daily = history.daily.slice(-90).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
      hourly = history.hourly.slice(-48).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
    } catch {
      // upstream history failure — chart will show "no data" but price stays live
    }
    const track = await getSignalHistory(14);

    return NextResponse.json({
      ok: true,
      snapshot,
      daily,
      hourly,
      trackRecord: track.stats,
      chain: {
        id: publicConfig.chainId,
        name: "Abstract",
        explorer: publicConfig.explorerUrl,
      },
      token: {
        symbol: snapshot.symbol,
        address: publicConfig.penguToken,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "MARKET_DATA_UNAVAILABLE", detail: String(err).slice(0, 200) },
      { status: 503 },
    );
  }
}
