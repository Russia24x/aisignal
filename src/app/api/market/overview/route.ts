/**
 * GET /api/market/overview — public live market snapshot + recent candles.
 * Free tier: gives everyone real data (transparency builds trust).
 *
 * v4: candles are served per-timeframe (15m/1h/4h/1d) from the plan's
 * cache ladder; the daily series doubles as the deterministic track-record
 * source. Chart data for 15m/1h/4h/1d feeds PriceChart's range chips.
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSnapshot, getTimeframe } from "@/lib/modules/market/service";
import { publicConfig } from "@/lib/config";
import { getSignalHistory } from "@/lib/modules/analysis/signal-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("market:overview");

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  try {
    // snapshot first — it's the critical live layer
    const snapshot = await getSnapshot();

    // candles are optional for the overview (chart may degrade gracefully)
    let daily: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
    let hourly: typeof daily = [];
    try {
      const [tf15, tf1h, tf4h, tf1d] = await Promise.all([
        getTimeframe("15m"),
        getTimeframe("1h"),
        getTimeframe("4h"),
        getTimeframe("1d"),
      ]);
      const trim = (candles: typeof daily, n: number) =>
        candles.slice(-n).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
      daily = trim(tf1d.candles, 120);
      hourly = trim(tf1h.candles, 48);
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
    // log the real cause server-side; clients only get the code (no
    // upstream URLs / internals leak through the API)
    log.error("snapshot failed", { err: String(err) });
    return NextResponse.json({ ok: false, error: "MARKET_DATA_UNAVAILABLE" }, { status: 503 });
  }
}
