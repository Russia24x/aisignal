/**
 * CoinMarketCap provider — TERTIARY fallback (keyless public endpoint).
 *
 * Uses CMC's public website data API (`/data-api/v3/cryptocurrency/listing`)
 * which requires no API key. PENGU (id 34466) sits inside the global top-100
 * listing, giving us price / 24h change / 24h volume / market cap when both
 * Binance and CoinGecko are unavailable.
 *
 * Note: this is CMC's keyless public dataset — NOT every pro endpoint is
 * keyless; only this listing shape is relied upon, and always as the LAST
 * fallback in the chain (see service.ts).
 *
 * @module lib/modules/market/coinmarketcap
 */
import { serverConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import type { MarketSnapshot } from "./types";

const log = createLogger("market:coinmarketcap");
const BASE = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing";
const PENGU_SYMBOL = "PENGU";

interface CmcQuote {
  name: string;
  price: number;
  volume24h: number;
  marketCap: number;
  percentChange1h: number;
  percentChange24h: number;
  fullyDilluttedMarketCap: number;
  lastUpdated: string;
}

interface CmcCoin {
  id: number;
  name: string;
  symbol: string;
  cmcRank: number;
  quotes: CmcQuote[];
}

async function fetchTop100(): Promise<CmcCoin[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), serverConfig.DATA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}?start=1&limit=100`, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        // data-api rejects generic bot UA strings; use a browser-like UA
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { cryptoCurrencyList?: CmcCoin[] } };
    const list = body.data?.cryptoCurrencyList;
    if (!Array.isArray(list)) throw new Error("UNEXPECTED_SHAPE");
    return list;
  } finally {
    clearTimeout(timer);
  }
}

/** Snapshot from CMC's keyless listing (last-resort fallback). */
export async function fetchSnapshot(): Promise<MarketSnapshot> {
  const list = await fetchTop100();
  const coin = list.find((c) => c.symbol === PENGU_SYMBOL);
  if (!coin) throw new Error("PENGU_NOT_LISTED");
  const usd = coin.quotes?.find((q) => q.name === "USD") ?? coin.quotes?.[0];
  if (!usd || !Number.isFinite(usd.price) || usd.price <= 0) {
    throw new Error("NO_USD_QUOTE");
  }
  log.debug("cmc snapshot fetched", { rank: coin.cmcRank, price: usd.price });
  return {
    symbol: "PENGU",
    priceUsd: usd.price,
    change5m: null,
    change1h: usd.percentChange1h ?? null,
    change6h: null,
    change24h: usd.percentChange24h ?? 0,
    volume24hUsd: usd.volume24h ?? 0,
    liquidityUsd: 0,
    fdvUsd: usd.fullyDilluttedMarketCap ?? null,
    marketCapUsd: usd.marketCap ?? null,
    dexId: "coinmarketcap",
    pairAddress: "",
    pairUrl: "https://coinmarketcap.com/currencies/pudgy-penguins/",
    quoteSymbol: "USD",
    fetchedAt: Date.now(),
    source: "coinmarketcap",
  };
}
