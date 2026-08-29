/**
 * DexScreener provider — live PENGU pair snapshot on Abstract.
 * Public API, no key required. Docs: https://docs.dexscreener.com/
 *
 * @module lib/modules/market/dexscreener
 */
import { serverConfig, publicConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import type { MarketSnapshot } from "./types";

const log = createLogger("market:dexscreener");

interface DSResponse {
  pairs?: Array<{
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: { address: string; name: string; symbol: string };
    quoteToken: { address: string; name: string; symbol: string };
    priceUsd?: string;
    priceNative?: string;
    txns?: Record<string, { buys: number; sells: number }>;
    volume?: Record<string, number>;
    priceChange?: Record<string, number>;
    liquidity?: { usd?: number; base?: number; quote?: number };
    fdv?: number;
    marketCap?: number;
    pairCreatedAt?: number;
  }>;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": "PenguSignals/1.0 (+https://abs.xyz)" },
      // Next fetch caching off — we manage caching ourselves
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the deepest-liquidity PENGU pair on Abstract chain.
 */
export async function fetchSnapshot(): Promise<MarketSnapshot> {
  const token = publicConfig.penguToken;
  const url = `https://api.dexscreener.com/latest/dex/tokens/${token}`;
  const data = await fetchJson<DSResponse>(url, serverConfig.DATA_FETCH_TIMEOUT_MS);

  const abstractPairs = (data.pairs ?? []).filter((p) => p.chainId === "abstract");
  if (abstractPairs.length === 0) {
    throw new Error("No Abstract pairs found for token");
  }
  // deepest liquidity first
  abstractPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const p = abstractPairs[0];

  if (!p.priceUsd) throw new Error("Missing priceUsd from DexScreener");

  const snapshot: MarketSnapshot = {
    symbol: p.baseToken.symbol,
    priceUsd: Number(p.priceUsd),
    change5m: p.priceChange?.m5 ?? null,
    change1h: p.priceChange?.h1 ?? null,
    change6h: p.priceChange?.h6 ?? null,
    change24h: p.priceChange?.h24 ?? 0,
    volume24hUsd: p.volume?.h24 ?? 0,
    liquidityUsd: p.liquidity?.usd ?? 0,
    fdvUsd: p.fdv ?? null,
    marketCapUsd: p.marketCap ?? null,
    dexId: p.dexId,
    pairAddress: p.pairAddress,
    pairUrl: p.url,
    quoteSymbol: p.quoteToken.symbol,
    fetchedAt: Date.now(),
    source: "dexscreener",
  };
  log.debug("snapshot fetched", { price: snapshot.priceUsd, liq: snapshot.liquidityUsd });
  return snapshot;
}
