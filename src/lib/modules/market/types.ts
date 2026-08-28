/**
 * Market data domain types.
 *
 * @module lib/modules/market/types
 */

/** Live snapshot of the PENGU market from DEX data. */
export interface MarketSnapshot {
  symbol: string;
  /** current price in USD */
  priceUsd: number;
  /** price changes in percent */
  change5m: number;
  change1h: number;
  change6h: number;
  change24h: number;
  /** 24h volume in USD */
  volume24hUsd: number;
  /** pool liquidity in USD */
  liquidityUsd: number;
  /** fully diluted valuation in USD */
  fdvUsd: number | null;
  /** market cap in USD */
  marketCapUsd: number | null;
  /** dex + pair info */
  dexId: string;
  pairAddress: string;
  pairUrl: string;
  quoteSymbol: string;
  fetchedAt: number;
  source: "dexscreener";
}

/** A single OHLCV candle. */
export interface Candle {
  /** unix ms — open time */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface HistoryData {
  /** daily candles, ascending, oldest first */
  daily: Candle[];
  /** hourly candles for the last 24-48h (intraday context) */
  hourly: Candle[];
  fetchedAt: number;
  sources: string[];
}

export interface MarketOverview {
  snapshot: MarketSnapshot;
  history: HistoryData;
}

/** Errors carrying HTTP-ish semantics for API mapping. */
export class MarketDataError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "MarketDataError";
  }
}
