/**
 * Binance provider — PRIMARY market data source for PENGU.
 *
 * Provides:
 *  - multi-timeframe OHLCV klines (15m / 1h / 4h / 1d) for the signal engine
 *  - 24h ticker snapshot (price, 24h change, 24h quote volume)
 *
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
import type { Candle, MarketSnapshot, Timeframe } from "./types";

const log = createLogger("market:binance");
const BASE = "https://api.binance.com";
const SYMBOL = "PENGUUSDT";
/** Also used for payment quotes (ETH side of a PENGU→ETH conversion). */
const ETH_SYMBOL = "ETHUSDT";

/** Candle counts per timeframe — enough warm-up for EMA50/RSI/MACD/ATR. */
const TF_LIMITS: Record<Timeframe, number> = {
  "15m": 200, // ~50 hours
  "1h": 200, // ~8 days
  "4h": 210, // ~35 days
  "1d": 120, // ~120 days
};

type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];

async function fetchJson<T>(path: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), serverConfig.DATA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "PenguSignals/1.0" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function mapKlines(raw: Kline[]): Candle[] {
  return raw.map((k) => ({
    t: k[0],
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[7]), // quote (USD) volume
  }));
}

/** OHLCV candles for one timeframe. */
export async function fetchKlines(timeframe: Timeframe, limitOverride?: number): Promise<Candle[]> {
  const limit = limitOverride ?? TF_LIMITS[timeframe];
  const raw = await fetchJson<Kline[]>(
    `/api/v3/klines?symbol=${SYMBOL}&interval=${timeframe}&limit=${limit}`,
  );
  return mapKlines(raw);
}

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

/**
 * Snapshot base from the Binance 24h ticker (price + 24h change + volume).
 * Short-window changes and Abstract pool fields are filled by the caller
 * (DexScreener enrichment or left null).
 */
export async function fetchTickerSnapshot(): Promise<MarketSnapshot> {
  const t = await fetchJson<Ticker24h>(`/api/v3/ticker/24hr?symbol=${SYMBOL}`);
  const price = Number(t.lastPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error("INVALID_TICKER_PRICE");
  return {
    symbol: "PENGU",
    priceUsd: price,
    change5m: null,
    change1h: null,
    change6h: null,
    change24h: Number(t.priceChangePercent) || 0,
    volume24hUsd: Number(t.quoteVolume) || 0,
    liquidityUsd: 0,
    fdvUsd: null,
    marketCapUsd: null,
    dexId: "binance",
    pairAddress: "",
    pairUrl: `https://www.binance.com/en/trade/${SYMBOL}`,
    quoteSymbol: "USDT",
    fetchedAt: Date.now(),
    source: "binance",
  };
}

/** Spot price for an arbitrary Binance pair (used by payment quotes). */
export async function fetchPairPrice(symbol: string): Promise<number> {
  const t = await fetchJson<Ticker24h>(`/api/v3/ticker/24hr?symbol=${symbol}`);
  const price = Number(t.lastPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`INVALID_PRICE_${symbol}`);
  return price;
}

/** ETH/USD price (payment quote cross-rate). */
export async function fetchEthPrice(): Promise<number> {
  return fetchPairPrice(ETH_SYMBOL);
}
