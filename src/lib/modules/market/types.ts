/**
 * Market data domain types.
 *
 * @module lib/modules/market/types
 */

/** Supported analysis timeframes (target plan §14 — deliberately few). */
export type Timeframe = "15m" | "1h" | "4h" | "1d";

export const TIMEFRAMES: readonly Timeframe[] = ["15m", "1h", "4h", "1d"] as const;

/** Live snapshot of the PENGU market. Assembled from Binance (price/24h),
 *  DexScreener (Abstract pair liquidity/FDV/short-term changes) with
 *  CoinGecko / CoinMarketCap as fallbacks. */
export interface MarketSnapshot {
  symbol: string;
  /** current price in USD */
  priceUsd: number;
  /** price changes in percent (null when the provider lacked the window) */
  change5m: number | null;
  change1h: number | null;
  change6h: number | null;
  change24h: number;
  /** 24h volume in USD */
  volume24hUsd: number;
  /** pool liquidity in USD (Abstract DEX pair; 0 when unknown) */
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
  /** which provider produced the price (binance | dexscreener | coingecko | coinmarketcap) */
  source: string;
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

/** Candle series for one timeframe (ascending, oldest first). */
export interface TimeframeData {
  timeframe: Timeframe;
  candles: Candle[];
  /** provider that produced the series */
  source: string;
  fetchedAt: number;
}
