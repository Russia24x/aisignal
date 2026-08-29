/**
 * Market service — the single façade the rest of the app uses for market data.
 *
 * Stateless by design (target plan): no persistence, only short-lived
 * in-memory caches. Responsibilities:
 *
 *  - SNAPSHOT chain:  Binance 24h ticker (primary price, deepest venue)
 *                     → enriched with DexScreener Abstract-pair data
 *                       (5m/1h/6h changes, liquidity, FDV, mcap, pair URL)
 *                     → full DexScreener snapshot (if Binance down)
 *                     → CoinGecko /coins/markets
 *                     → CoinMarketCap keyless listing
 *  - CANDLE chain per timeframe: Binance klines → CoinGecko OHLC (aggregated)
 *  - per-timeframe caches with the plan's TTL ladder (§13):
 *      15m → 30s, 1h → 60s, 4h/1d → 120s  (+ history series 15 min)
 *
 * @module lib/modules/market/service
 */
import { TTLCache } from "@/lib/cache";
import { serverConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { fetchSnapshot as fetchDexSnapshot } from "./dexscreener";
import {
  fetchKlines,
  fetchTickerSnapshot,
} from "./binance";
import {
  fetchSnapshot as fetchCgSnapshot,
  fetchTimeframe as fetchCgTimeframe,
  fetchSimplePrice,
} from "./coingecko";
import { fetchSnapshot as fetchCmcSnapshot } from "./coinmarketcap";
import type { Candle, MarketSnapshot, Timeframe, TimeframeData } from "./types";

const log = createLogger("market:service");

const snapshotCache = new TTLCache<MarketSnapshot>(serverConfig.MARKET_CACHE_TTL_MS);

/** One cache per timeframe — each with its own TTL from config. */
const tfCaches: Record<Timeframe, TTLCache<TimeframeData>> = {
  "15m": new TTLCache<TimeframeData>(serverConfig.timeframeTtlMs["15m"]),
  "1h": new TTLCache<TimeframeData>(serverConfig.timeframeTtlMs["1h"]),
  "4h": new TTLCache<TimeframeData>(serverConfig.timeframeTtlMs["4h"]),
  "1d": new TTLCache<TimeframeData>(serverConfig.timeframeTtlMs["1d"]),
};

/** Long daily series for deterministic history recomputation (15 min TTL). */
const historyCache = new TTLCache<Candle[]>(serverConfig.HISTORY_CACHE_TTL_MS);

/**
 * Cross-check throttle: CoinGecko simple-price is only needed as an ops signal,
 * not per-refresh. Checking every 10th cache miss (≈ every 10 min under traffic)
 * keeps free-tier CoinGecko usage at ≤6 calls/hr instead of ≤60.
 */
const CROSS_CHECK_EVERY = 10;
let snapshotMissCount = 0;

/** Merge Abstract-pair enrichment (DexScreener) into a Binance-based snapshot. */
function enrich(base: MarketSnapshot, extra: MarketSnapshot): MarketSnapshot {
  return {
    ...base,
    change5m: base.change5m ?? extra.change5m,
    change1h: base.change1h ?? extra.change1h,
    change6h: base.change6h ?? extra.change6h,
    volume24hUsd: base.volume24hUsd || extra.volume24hUsd,
    liquidityUsd: extra.liquidityUsd,
    fdvUsd: extra.fdvUsd,
    marketCapUsd: extra.marketCapUsd,
    dexId: extra.dexId,
    pairAddress: extra.pairAddress,
    pairUrl: extra.pairUrl,
    quoteSymbol: extra.quoteSymbol,
  };
}

export async function getSnapshot(): Promise<MarketSnapshot> {
  return snapshotCache.getOrRefresh("pengu", async () => {
    snapshotMissCount += 1;

    // 1. Binance ticker (primary price) + best-effort DexScreener enrichment
    let binanceSnap: MarketSnapshot | null = null;
    try {
      binanceSnap = await fetchTickerSnapshot();
    } catch (err) {
      log.warn("binance ticker failed", { err: String(err) });
    }
    if (binanceSnap) {
      try {
        const ds = await fetchDexSnapshot();
        const merged = enrich(binanceSnap, ds);
        // sanity: if the two venues disagree wildly (>10%), trust Binance price
        // but log the divergence as an ops signal
        const divergence = Math.abs(ds.priceUsd - binanceSnap.priceUsd) / binanceSnap.priceUsd;
        if (divergence > 0.1) {
          log.warn("price divergence between binance and dexscreener", {
            binance: binanceSnap.priceUsd,
            dex: ds.priceUsd,
            divergence,
          });
        }
        maybeCrossCheck(merged);
        return merged;
      } catch (err) {
        log.warn("dexscreener enrichment failed, using binance-only snapshot", {
          err: String(err),
        });
        maybeCrossCheck(binanceSnap);
        return binanceSnap;
      }
    }

    // 2. DexScreener standalone
    try {
      const ds = await fetchDexSnapshot();
      maybeCrossCheck(ds);
      return ds;
    } catch (err) {
      log.warn("dexscreener failed, falling back to coingecko", { err: String(err) });
    }

    // 3. CoinGecko → 4. CoinMarketCap (keyless)
    try {
      return await fetchCgSnapshot();
    } catch (err) {
      log.warn("coingecko snapshot failed, falling back to coinmarketcap", { err: String(err) });
    }
    return fetchCmcSnapshot();
  });
}

function maybeCrossCheck(snap: MarketSnapshot): void {
  // ops-only price cross-check against CoinGecko, throttled
  if (snapshotMissCount % CROSS_CHECK_EVERY === 1) {
    void fetchSimplePrice()
      .then((cg) => {
        if (cg && snap.priceUsd > 0) {
          const divergence = Math.abs(cg - snap.priceUsd) / snap.priceUsd;
          if (divergence > 0.05) {
            log.warn("price divergence between providers", { main: snap.priceUsd, cg, divergence });
          }
        }
      })
      .catch(() => undefined);
  }
}

/** Candles for one timeframe: Binance klines → CoinGecko fallback. */
export async function getTimeframe(timeframe: Timeframe): Promise<TimeframeData> {
  return tfCaches[timeframe].getOrRefresh(timeframe, async () => {
    try {
      const candles = await fetchKlines(timeframe);
      if (candles.length >= 60) {
        return { timeframe, candles, source: "binance-klines", fetchedAt: Date.now() };
      }
      log.warn("binance klines insufficient, falling back to coingecko", {
        timeframe,
        count: candles.length,
      });
    } catch (err) {
      log.warn("binance klines failed, falling back to coingecko", {
        timeframe,
        err: String(err),
      });
    }
    const candles = await fetchCgTimeframe(timeframe);
    return {
      timeframe,
      candles,
      source: "coingecko-ohlc",
      fetchedAt: Date.now(),
    };
  });
}

/**
 * Long daily series (Binance, up to 365 candles) for deterministic history
 * recomputation. Cached 15 min — shared by history/detail/track-record.
 */
export async function getDailySeries(): Promise<Candle[]> {
  return historyCache.getOrRefresh("daily-365", async () => {
    try {
      const candles = await fetchKlines("1d", 365);
      if (candles.length >= 60) return candles;
      log.warn("binance daily series short", { count: candles.length });
    } catch (err) {
      log.warn("binance daily series failed, falling back to coingecko", { err: String(err) });
    }
    // CoinGecko fallback: days=365 → daily granularity
    return fetchCgTimeframe("1d");
  });
}