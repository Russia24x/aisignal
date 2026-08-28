"use client";

/**
 * LiveTicker — thin horizontal marquee bar rendered directly under the Header.
 *
 * Streams the PENGU/USD price over WebSocket (via `useTicker`) and renders
 * price / 24h change / volume / liquidity / fdv with colored ▲/▼ indicators.
 * Falls back to a muted "loading…" state until the first tick arrives.
 *
 * Always LTR — numeric content, regardless of the active i18n locale.
 *
 * @module components/pengu/LiveTicker
 */
import { useTicker } from "@/hooks/useTicker";
import { fmt } from "./useMarket";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";

interface StatProps {
  label: string;
  value: string;
  tone?: "up" | "down" | "neutral";
  icon?: "up" | "down" | null;
}

function Stat({ label, value, tone = "neutral", icon = null }: StatProps) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground/70">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          tone === "up" && "text-buy",
          tone === "down" && "text-sell",
        )}
      >
        {icon === "up" && <ArrowUp className="inline size-3 align-middle" />}
        {icon === "down" && <ArrowDown className="inline size-3 align-middle" />}
        <span className="ms-0.5">{value}</span>
      </span>
    </span>
  );
}

function Sep() {
  return <span className="text-muted-foreground/30" aria-hidden>•</span>;
}

export function LiveTicker() {
  const { price, change24h, volume24h, liquidityUsd, fdv, fetchedAt, connected } =
    useTicker();

  const hasData = price !== null;
  const positive = (change24h ?? 0) >= 0;

  return (
    <div
      dir="ltr"
      className="border-b border-border/50 bg-card/40 backdrop-blur-xl text-xs font-mono"
    >
      <div className="mx-auto flex h-9 max-w-6xl items-center gap-3 overflow-x-auto px-4 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Label + green pulsing dot */}
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
          <span className="relative grid place-items-center">
            <span
              className={cn(
                "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                connected ? "bg-buy" : "bg-muted-foreground/40",
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-1.5 rounded-full pulse-ring",
                connected ? "bg-buy" : "bg-muted-foreground/50",
              )}
            />
          </span>
          <span className="font-bold tracking-wider">PENGU/USD LIVE</span>
        </div>

        <span className="shrink-0 text-muted-foreground/30" aria-hidden>|</span>

        {hasData ? (
          <div className="flex shrink-0 items-center gap-3">
            <Stat label="PRICE" value={fmt.price(price)} />
            <Sep />
            <Stat
              label="24H"
              value={fmt.pct(change24h)}
              tone={positive ? "up" : "down"}
              icon={positive ? "up" : "down"}
            />
            <Sep />
            <Stat label="VOL" value={fmt.usd(volume24h)} />
            <Sep />
            <Stat label="LIQ" value={fmt.usd(liquidityUsd)} />
            <Sep />
            <Stat label="FDV" value={fmt.usd(fdv)} />
            {fetchedAt !== null && (
              <>
                <Sep />
                <span className="text-muted-foreground/50">
                  {new Date(fetchedAt).toLocaleTimeString("en-US", {
                    hour12: false,
                  })}
                </span>
              </>
            )}
          </div>
        ) : (
          <span className="shrink-0 text-muted-foreground/60">loading…</span>
        )}

        {!connected && hasData && (
          <span className="ms-auto shrink-0 text-muted-foreground/50">
            reconnecting…
          </span>
        )}
      </div>
    </div>
  );
}
