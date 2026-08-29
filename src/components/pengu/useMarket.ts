"use client";

/**
 * Live market data hook — polls /api/market/overview.
 * All data comes from the server (server-side caching protects upstreams).
 *
 * @module components/pengu/useMarket
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface MarketSnapshot {
  symbol: string;
  priceUsd: number;
  change5m: number | null;
  change1h: number | null;
  change6h: number | null;
  change24h: number;
  volume24hUsd: number;
  liquidityUsd: number;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  dexId: string;
  pairAddress: string;
  pairUrl: string;
  quoteSymbol: string;
  fetchedAt: number;
  source: string;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface MarketData {
  snapshot: MarketSnapshot;
  daily: Candle[];
  hourly: Candle[];
  trackRecord: {
    total: number;
    closed: number;
    wins: number;
    losses: number;
    winRate: number;
    avgConfidence: number;
  };
  chain: { id: number; name: string; explorer: string };
  token: { symbol: string; address: string };
}

const POLL_MS = 60_000;

export function useMarket() {
  const [data, setData] = useState<MarketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const prevPrice = useRef<number | null>(null);
  const [tick, setTick] = useState<"up" | "down" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market/overview", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        const next = json as MarketData & { ok: true };
        if (prevPrice.current !== null && next.snapshot.priceUsd !== prevPrice.current) {
          setTick(next.snapshot.priceUsd > prevPrice.current ? "up" : "down");
          setTimeout(() => setTick(null), 900);
        }
        prevPrice.current = next.snapshot.priceUsd;
        setData(next);
        setError(null);
      } else {
        setError(json.error ?? "MARKET_DATA_UNAVAILABLE");
      }
    } catch {
      setError("NETWORK");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return { data, error, loading, refresh: load, tick };
}

/** Formatting helpers (shared across components). */
export const fmt = {
  usd(n: number | null | undefined, maxDigits = 5): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(Math.min(maxDigits, 6))}`;
  },
  price(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    return `$${n.toFixed(5)}`;
  },
  pct(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  },
};
