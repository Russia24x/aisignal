"use client";

/**
 * LiveTicker — thin horizontal bar rendered directly under the Header.
 *
 * Single feed: the server-cached REST snapshot from /api/market/overview
 * (useMarket, ~60s freshness). This is the ONLY mode — it runs identically
 * on the dev sandbox and on Cloudflare Workers (free tier), where a
 * separate socket.io service cannot run. The old ws-ticker mini-service
 * was removed for full free-tier compliance.
 *
 * Always LTR — numeric content, regardless of the active i18n locale.
 *
 * @module components/pengu/LiveTicker
 */
import { useMarket, fmt } from "./useMarket";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";

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
  const market = useMarket();

  const rest = market.data?.snapshot ?? null;
  const price = rest?.priceUsd ?? null;
  const change24h = rest?.change24h ?? null;
  const volume24h = rest?.volume24hUsd ?? null;
  const liquidityUsd = rest?.liquidityUsd ?? null;
  const fdv = rest?.fdvUsd ?? null;
  const fetchedAt = rest?.fetchedAt ?? null;
  // live = a fresh REST snapshot is rendering (auto-poll every 60s)
  const live = !!rest && !market.error;

  const hasData = price !== null;
  const positive = (change24h ?? 0) >= 0;

  return (
    <div
      dir="ltr"
      className="border-b border-border/50 bg-card/40 backdrop-blur-xl text-xs font-mono"
    >
      <div className="mx-auto flex h-9 max-w-6xl items-center gap-3 overflow-x-auto px-4 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Label + status dot */}
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
          <span className="relative grid place-items-center">
            <span
              className={cn(
                "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                live ? "bg-buy" : "bg-muted-foreground/40",
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-1.5 rounded-full pulse-ring",
                live ? "bg-buy" : "bg-muted-foreground/50",
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

        {hasData && (
          <span
            className="ms-auto flex shrink-0 items-center gap-1 text-muted-foreground/50"
            title="Server-cached snapshot — refreshed every ~60s"
          >
            <RefreshCw className="size-3" aria-hidden />
            ~60s
          </span>
        )}
      </div>
    </div>
  );
}
