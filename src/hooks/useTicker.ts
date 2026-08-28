"use client";

/**
 * useTicker — live PENGU price feed over WebSocket.
 *
 * Connects to the `ws-ticker` mini-service via the Caddy gateway:
 *   io("/?XTransformPort=3033")
 * Path is always `/`, the gateway inspects the `XTransformPort` query and
 * reverse-proxies to localhost:3033. NEVER use a direct localhost:3033 URL.
 *
 * `socket.io-client` is loaded lazily in the browser only (dynamic import)
 * to avoid pulling Node.js polyfills into the SSR bundle and to keep the
 * connection out of server-side rendering entirely.
 *
 * Auto-reconnect with exponential backoff is handled by socket.io defaults.
 *
 * @module hooks/useTicker
 */
import { useEffect, useState } from "react";

export interface UseTickerResult {
  /** latest PENGU price in USD, null until first tick */
  price: number | null;
  /** 24h price change in percent, null until first tick */
  change24h: number | null;
  /** 24h volume in USD, null until first tick */
  volume24h: number | null;
  /** pool liquidity in USD, null until first tick */
  liquidityUsd: number | null;
  /** fully diluted valuation in USD, null until first tick */
  fdv: number | null;
  /** server-side fetch epoch ms, null until first tick */
  fetchedAt: number | null;
  /** true while the socket transport is open */
  connected: boolean;
}

interface ServerSnapshot {
  priceUsd?: number;
  change24h?: number;
  volume24h?: number;
  liquidityUsd?: number;
  fdv?: number | null;
  fetchedAt?: number;
}

const INITIAL: UseTickerResult = {
  price: null,
  change24h: null,
  volume24h: null,
  liquidityUsd: null,
  fdv: null,
  fetchedAt: null,
  connected: false,
};

export function useTicker(): UseTickerResult {
  const [state, setState] = useState<UseTickerResult>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    // socket.io-client is dynamically imported; we cast to a loose type to
    // avoid TS interop quirks between ESM/CJS namespaces vs the default
    // callable export (`lookup` aliased as both `io` and `default`).
    let socket: any = null;

    void (async () => {
      try {
        // lazy browser-only import → keeps SSR bundle clean
        const mod: any = await import("socket.io-client");
        const io = mod.io ?? mod.default?.io ?? mod.default;
        if (cancelled || typeof window === "undefined" || typeof io !== "function") return;

        // MANDATORY: path `/` + XTransformPort=3033 (never a direct localhost URL)
        // Transport: polling-only. The sandbox gateway (Caddy) does not
        // reliably pass WebSocket upgrades on this route, and a failed upgrade
        // tears the connection down into a reconnect loop. socket.io long-
        // polling is more than enough for a 15s price feed and keeps the
        // connection stable behind any proxy.
        socket = io("/?XTransformPort=3033", {
          transports: ["polling"],
          upgrade: false,
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1_000,
          reconnectionDelayMax: 10_000,
          timeout: 10_000,
        });

        socket.on("connect", () => {
          if (!cancelled) setState((s) => ({ ...s, connected: true }));
        });
        socket.on("disconnect", () => {
          if (!cancelled) setState((s) => ({ ...s, connected: false }));
        });
        socket.on("connect_error", (err: unknown) => {
          // surfaced for dev visibility — socket.io will keep retrying
          console.warn("[useTicker] connect_error", err);
        });
        socket.on("price", (snap: ServerSnapshot) => {
          if (!cancelled && snap) {
            setState((s) => ({
              ...s,
              price: typeof snap.priceUsd === "number" ? snap.priceUsd : s.price,
              change24h:
                typeof snap.change24h === "number" ? snap.change24h : s.change24h,
              volume24h:
                typeof snap.volume24h === "number" ? snap.volume24h : s.volume24h,
              liquidityUsd:
                typeof snap.liquidityUsd === "number"
                  ? snap.liquidityUsd
                  : s.liquidityUsd,
              fdv:
                typeof snap.fdv === "number" ? snap.fdv : snap.fdv === null ? null : s.fdv,
              fetchedAt:
                typeof snap.fetchedAt === "number" ? snap.fetchedAt : s.fetchedAt,
            }));
          }
        });
      } catch (err) {
        console.error("[useTicker] failed to load socket.io-client", err);
      }
    })();

    return () => {
      cancelled = true;
      if (socket) {
        try {
          socket.removeAllListeners();
          socket.disconnect();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  return state;
}
