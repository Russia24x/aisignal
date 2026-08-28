/**
 * Binance provider — historical OHLCV klines for PENGU/USDT.
 * Public API, no key required, generous rate limits.
 * Docs: https://developers.binance.com/docs/binance-spot-api-docs
 *
 * Kline format:
 * [openTime, open, high, low, close, volume(base), closeTime,
 *  quoteVolume(usd), trades, takerBase, takerQuote, ignore]
 *
 * We use quoteVolume (USD) as candle volume — volume indicators should
 * weight by notional value, not token count.
 *
 * @module lib/modules/market/binance
 */
import { serverConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import type { Candle } from "./types";

const log = createLogger("market:binance");
const BASE = "https://api.binance.com";
const SYMBOL = "PENGUUSDT";

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

async function fetchKlines(interval: "1d" | "1h", limit: number): Promise<Candle[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), serverConfig.DATA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&limit=${limit}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "PenguSignals/1.0" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as Kline[];
    return raw.map((k) => ({
      t: k[0],
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[7]), // quote (USD) volume
    }));
  } finally {
    clearTimeout(timer);
  }
}

export interface HistoryResult {
  daily: Candle[];
  hourly: Candle[];
  source: string;
}

/** Daily (90) + hourly (48) candles from Binance. */
export async function fetchHistory(): Promise<HistoryResult> {
  const [daily, hourly] = await Promise.all([fetchKlines("1d", 90), fetchKlines("1h", 48)]);
  log.debug("binance history fetched", { daily: daily.length, hourly: hourly.length });
  return { daily, hourly, source: "binance-klines" };
}
