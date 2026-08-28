/**
 * CoinGecko provider — historical OHLCV data for PENGU.
 * Public API (demo tier), no key required. Docs: https://docs.coingecko.com/
 *
 * CoinGecko granularity:
 *  - days=1      → 5-minute points
 *  - days=2..90  → hourly points
 *  - days>90     → daily points
 *
 * Strategy: fetch `days=90` (hourly) and aggregate to daily candles for
 * long-horizon indicators, plus `days=2` (hourly) for fresh intraday candles.
 *
 * @module lib/modules/market/coingecko
 */
import { serverConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import type { Candle } from "./types";

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
 * Fetch hourly points for the last `days` and aggregate into candles.
 * Uses the ohlc endpoint which returns true OHLC at the source granularity.
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

/** Aggregate candles into UTC-day buckets. */
export function aggregateToDaily(candles: Candle[]): Candle[] {
  const byDay = new Map<string, Candle>();
  for (const c of candles) {
    const day = new Date(c.t).toISOString().slice(0, 10);
    const existing = byDay.get(day);
    if (!existing) {
      byDay.set(day, { ...c, t: Date.parse(`${day}T00:00:00Z`) });
    } else {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c;
      existing.v += c.v;
    }
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

export interface HistoryResult {
  daily: Candle[];
  hourly: Candle[];
  sources: string[];
}

/** Fetch 90 days of history: daily (aggregated from hourly) + fresh hourly. */
export async function fetchHistory(): Promise<HistoryResult> {
  // days=90 → hourly granularity
  const hourly90 = await fetchOhlc(90);
  const daily = aggregateToDaily(hourly90);
  // fresh hourly (days=2 → hourly, most recent points)
  const hourly2 = await fetchOhlc(2);
  return { daily, hourly: hourly2, sources: ["coingecko-ohlc", "coingecko-market_chart"] };
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
