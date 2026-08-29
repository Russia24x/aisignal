/**
 * CoinGecko provider — SECONDARY fallback for price snapshot and candles.
 *
 * Public API (demo tier), no key required. Docs: https://docs.coingecko.com/
 *
 * CoinGecko granularity:
 *  - days=1      → 5-minute points
 *  - days=2..90  → hourly points
 *  - days>90     → daily points
 *
 * Timeframe fallback mapping (see service.ts for orchestration):
 *  - 15m → days=1 (5-min points, aggregated to 15m)
 *  - 1h  → days=14 (hourly points)
 *  - 4h  → days=30 (hourly points, aggregated to 4h)
 *  - 1d  → days=120 (daily points)
 *
 * @module lib/modules/market/coingecko
 */
import { serverConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import type { Candle, MarketSnapshot, Timeframe } from "./types";

const log = createLogger("market:coingecko");
const BASE = "https://api.coingecko.com/api/v3";
const COIN_ID = "pudgy-penguins";

async function fetchJson<T>(url: string, timeoutMs: number, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: "application/json", "user-agent": "PenguSignals/1.0" },
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        // transient upstream failure → exponential backoff
        await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("FETCH_FAILED");
}

/** OHLC entry: [timestamp, open, high, low, close] */
type OhlcEntry = [number, number, number, number, number];

/** market_chart entry prices: [timestamp, price] ; volumes: [timestamp, volume] */
interface MarketChart {
  prices: [number, number][];
  total_volumes: [number, number][];
}

/**
 * Fetch raw points for the last `days` (with volumes merged from
 * market_chart) — source granularity depends on `days` (see header).
 */
async function fetchOhlc(days: number): Promise<Candle[]> {
  const url = `${BASE}/coins/${COIN_ID}/ohlc?vs_currency=usd&days=${days}`;
  const raw = await fetchJson<OhlcEntry[]>(url, serverConfig.DATA_FETCH_TIMEOUT_MS);
  // Each entry: [ts, o, h, l, c]. Volume comes separately → merge from market_chart.
  let volumes = new Map<number, number>();
  try {
    const chart = await fetchJson<MarketChart>(
      `${BASE}/coins/${COIN_ID}/market_chart?vs_currency=usd&days=${days}`,
      serverConfig.DATA_FETCH_TIMEOUT_MS,
    );
    volumes = new Map(chart.total_volumes.map(([t, v]) => [t, v]));
  } catch (err) {
    log.warn("volume fetch failed, candles will carry zero volume", { err: String(err) });
  }

  const candles: Candle[] = raw.map(([t, o, h, l, c]) => {
    // find nearest volume sample
    let v = 0;
    let best = Infinity;
    for (const [vt, vv] of volumes) {
      const d = Math.abs(vt - t);
      if (d < best) {
        best = d;
        v = vv;
      }
    }
    return { t, o, h, l, c, v };
  });
  return candles.sort((a, b) => a.t - b.t);
}

/** Aggregate candles into fixed UTC buckets of `intervalMs`. */
export function aggregateToInterval(candles: Candle[], intervalMs: number): Candle[] {
  const byBucket = new Map<number, Candle>();
  for (const c of candles) {
    const bucket = Math.floor(c.t / intervalMs) * intervalMs;
    const existing = byBucket.get(bucket);
    if (!existing) {
      byBucket.set(bucket, { ...c, t: bucket });
    } else {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c;
      existing.v += c.v;
    }
  }
  return [...byBucket.values()].sort((a, b) => a.t - b.t);
}

const TF_MS: Record<Timeframe, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

/** CoinGecko day-window per timeframe (granularity rules above). */
const TF_DAYS: Record<Timeframe, number> = {
  "15m": 1,
  "1h": 14,
  "4h": 30,
  "1d": 120,
};

/** Fallback candles for one timeframe (aggregated to the TF bucket). */
export async function fetchTimeframe(timeframe: Timeframe): Promise<Candle[]> {
  const raw = await fetchOhlc(TF_DAYS[timeframe]);
  return aggregateToInterval(raw, TF_MS[timeframe]);
}

interface MarketsEntry {
  id: string;
  current_price: number;
  market_cap: number | null;
  fully_diluted_valuation: number | null;
  total_volume: number;
  price_change_percentage_24h: number | null;
  price_change_percentage_1h_in_currency: number | null;
}

/** Snapshot fallback from /coins/markets (one call: price, mcap, volume, 24h). */
export async function fetchSnapshot(): Promise<MarketSnapshot> {
  const list = await fetchJson<MarketsEntry[]>(
    `${BASE}/coins/markets?vs_currency=usd&ids=${COIN_ID}&per_page=1&page=1`,
    serverConfig.DATA_FETCH_TIMEOUT_MS,
  );
  const m = list?.[0];
  if (!m || !Number.isFinite(m.current_price) || m.current_price <= 0) {
    throw new Error("NO_MARKETS_ENTRY");
  }
  return {
    symbol: "PENGU",
    priceUsd: m.current_price,
    change5m: null,
    change1h: m.price_change_percentage_1h_in_currency ?? null,
    change6h: null,
    change24h: m.price_change_percentage_24h ?? 0,
    volume24hUsd: m.total_volume ?? 0,
    liquidityUsd: 0,
    fdvUsd: m.fully_diluted_valuation ?? null,
    marketCapUsd: m.market_cap ?? null,
    dexId: "coingecko",
    pairAddress: "",
    pairUrl: `https://www.coingecko.com/en/coins/${COIN_ID}`,
    quoteSymbol: "USD",
    fetchedAt: Date.now(),
    source: "coingecko",
  };
}

/**
 * Fetch current price from simple/price endpoint (used as cross-check).
 */
export async function fetchSimplePrice(): Promise<number | null> {
  try {
    const data = await fetchJson<Record<string, { usd: number }>>(
      `${BASE}/simple/price?ids=${COIN_ID}&vs_currencies=usd`,
      serverConfig.DATA_FETCH_TIMEOUT_MS,
    );
    return data[COIN_ID]?.usd ?? null;
  } catch {
    return null;
  }
}
