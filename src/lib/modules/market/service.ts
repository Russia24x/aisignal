/**
 * Market service — the single façade the rest of the app uses for market data.
 *
 * Responsibilities:
 *  - caching (TTL + stale-while-revalidate) so upstream APIs are protected
 *  - provider fallback with cross-checks:
 *      live snapshot  : DexScreener (Abstract DEX pair)
 *      daily/hourly   : Binance klines (primary) → CoinGecko OHLC (fallback)
 *  - hooks: price-alert checker runs on every fresh snapshot (fire-and-forget)
 *
 * @module lib/modules/market/service
 */
import { TTLCache } from "@/lib/cache";
import { serverConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { fetchSnapshot } from "./dexscreener";
import { fetchHistory as fetchBinanceHistory } from "./binance";
import { fetchHistory as fetchCoinGeckoHistory, fetchSimplePrice } from "./coingecko";
import { checkAlerts } from "@/lib/modules/alerts/checker";
import type { Candle, HistoryData, MarketSnapshot } from "./types";

const log = createLogger("market:service");

const snapshotCache = new TTLCache<MarketSnapshot>(serverConfig.MARKET_CACHE_TTL_MS);
const historyCache = new TTLCache<HistoryData>(serverConfig.HISTORY_CACHE_TTL_MS);

/**
 * Cross-check throttle: CoinGecko simple-price is only needed as an ops signal,
 * not per-refresh. Checking every 10th cache miss (≈ every 10 min under traffic)
 * keeps free-tier CoinGecko usage at ≤6 calls/hr instead of ≤60.
 */
const CROSS_CHECK_EVERY = 10;
let snapshotMissCount = 0;

export async function getSnapshot(): Promise<MarketSnapshot> {
  return snapshotCache.getOrRefresh("pengu", async () => {
    const snap = await fetchSnapshot();
    // cross-check price against CoinGecko; log large divergence (ops signal)
    snapshotMissCount += 1;
    if (snapshotMissCount % CROSS_CHECK_EVERY === 1) {
      const cg = await fetchSimplePrice();
      if (cg && snap.priceUsd > 0) {
        const divergence = Math.abs(cg - snap.priceUsd) / snap.priceUsd;
        if (divergence > 0.05) {
          log.warn("price divergence between providers", { dex: snap.priceUsd, cg, divergence });
        }
      }
    }
    // fire-and-forget: evaluate price alerts against this fresh snapshot
    // (only fires when the cache actually misses — every MARKET_CACHE_TTL_MS)
    void checkAlerts(snap.priceUsd).catch((err) =>
      log.warn("alert checker failed", { err: String(err) }),
    );
    return snap;
  });
}

export async function getHistory(): Promise<HistoryData> {
  return historyCache.getOrRefresh("pengu", async () => {
    // primary: Binance klines (reliable, true OHLCV, USD volumes)
    try {
      const { daily, hourly, source } = await fetchBinanceHistory();
      if (daily.length >= 35) {
        return { daily, hourly, fetchedAt: Date.now(), sources: [source] };
      }
    } catch (err) {
      log.warn("binance history failed, falling back to coingecko", { err: String(err) });
    }
    // fallback: CoinGecko (hourly aggregated to daily)
    const cg = await fetchCoinGeckoHistory();
    return {
      daily: cg.daily,
      hourly: cg.hourly,
      fetchedAt: Date.now(),
      sources: [...cg.sources, "fallback"],
    };
  });
}

export interface CandleWindow {
  candles: Candle[];
  dataQuality: number;
}

/**
 * Daily candles ending "today", trimmed to at most `maxDays`.
 * dataQuality penalizes short histories (indicator warm-up).
 */
export function analysisWindow(history: HistoryData, maxDays = 90): CandleWindow {
  const daily = history.daily.slice(-maxDays);
  const minForQuality = 60;
  const dataQuality = daily.length >= minForQuality ? 1 : Math.max(0.4, daily.length / minForQuality);
  return { candles: daily, dataQuality };
}
