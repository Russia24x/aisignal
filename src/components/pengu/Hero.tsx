"use client";

/**
 * Hero — headline, live market stats, and the mascot.
 *
 * @module components/pengu/Hero
 */
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMarket, fmt } from "./useMarket";
import { ShareButton } from "./ShareButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, LineChart, RefreshCw, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";

export function Hero() {
  const { t } = useI18n();
  const { data, loading, refresh } = useMarket();

  const s = data?.snapshot;
  const stats: Array<{
    label: string;
    raw: number | undefined;
    format: (v: number) => string;
    accent?: boolean;
    up?: boolean;
  }> = [
    { label: t("hero.statPrice"), raw: s?.priceUsd, format: (v) => fmt.price(v), accent: true },
    { label: t("hero.statChange24h"), raw: s?.change24h, format: (v) => fmt.pct(v), up: (s?.change24h ?? 0) >= 0 },
    { label: t("hero.statVolume"), raw: s?.volume24hUsd, format: (v) => fmt.usd(v) },
    { label: t("hero.statLiquidity"), raw: s?.liquidityUsd, format: (v) => fmt.usd(v) },
    { label: t("hero.statMcap"), raw: s?.marketCapUsd ?? s?.fdvUsd ?? undefined, format: (v) => fmt.usd(v) },
  ];

  return (
    <section id="top" className="relative overflow-hidden px-4 pb-10 pt-14 sm:pt-20">
      {/* ambient orbs */}
      <div
        className="aurora-orb size-72 bg-primary/30 start-[-4rem] top-8"
        aria-hidden
      />
      <div
        className="aurora-orb size-56 bg-ice/20 end-[-3rem] top-24"
        aria-hidden
      />
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
        {/* Copy */}
        <div>
          <Badge variant="outline" className="mb-5 gap-1.5 border-primary/40 bg-primary/10 px-3 py-1 text-primary">
            <Snowflake className="size-3.5" />
            {t("hero.badge")}
          </Badge>
          <h1 className="text-balance text-4xl font-black leading-[1.12] tracking-tight sm:text-5xl lg:text-6xl">
            <span className="block">{t("hero.title1")}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-gradient drop-shadow-[0_0_28px_oklch(0.72_0.16_165/0.45)]">
                PENGU
              </span>
              <Image
                src="/pengu-mascot.png"
                alt="Pengu mascot"
                width={56}
                height={56}
                className="floaty size-11 rounded-2xl ring-2 ring-primary/30 sm:size-14"
                priority
              />
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">
            {t("hero.subtitle")}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#signal">
              <Button size="lg" className="cta-glow gap-2 px-7 text-base font-bold">
                <LineChart className="size-5" />
                {t("hero.ctaPrimary")}
              </Button>
            </a>
            <a href="#engine">
              <Button size="lg" variant="outline" className="px-6 text-base">
                {t("hero.ctaSecondary")}
                <ArrowDown className="size-4" />
              </Button>
            </a>
            {/* viral loop: share the live snapshot + today's consensus */}
            <ShareButton />
          </div>

          {/* stats row — the 5th card spans the full row on mobile so the
              2-col grid never leaves an orphan cell */}
          <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {stats.map((st, i) => (
              <StatCard key={st.label} stat={st} loading={loading} span={i === stats.length - 1} />
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3" />
            {t("hero.liveOn")} Abstract ·{" "}
            {s ? (
              <>
                {t("hero.updated")}{" "}
                {new Date(s.fetchedAt).toLocaleTimeString(localeTime(t), {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </>
            ) : (
              "DexScreener / CoinGecko"
            )}
          </div>
        </div>

        {/* Chart card */}
        <div className="glass-card overflow-hidden p-5" id="market">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-ice/15 font-mono text-xs font-black text-ice ring-1 ring-ice/30">
                🐧
              </span>
              <div>
                <div className="text-sm font-bold">PENGU / {s?.quoteSymbol ?? "WETH"}</div>
                <div className="text-[11px] text-muted-foreground">
                  {s ? `${s.dexId} · ${data?.chain.name}` : "Abstract"}
                </div>
              </div>
            </div>
            <a
              href={s?.pairUrl ?? "https://dexscreener.com/abstract"}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              DexScreener ↗
            </a>
          </div>
          <MiniSparkline />
        </div>
      </div>
    </section>
  );
}

function localeTime(t: (k: string) => string): string {
  // fa → fa-IR numerals with Persian digits handled by Intl
  return t("brand.name").includes("پنگو") ? "fa-IR" : "en-US";
}

/* ------------------------------------------------------------------ */
/* StatCard — live value with a one-time count-up entrance             */
/* ------------------------------------------------------------------ */

interface StatDef {
  label: string;
  raw: number | undefined;
  format: (v: number) => string;
  accent?: boolean;
  up?: boolean;
}

/**
 * Count-up: animates 0 → target ONCE (first data arrival); later
 * refreshes snap to the new value instantly (the tick-up/tick-down
 * colour flash already covers live changes). Reduced motion → snap.
 */
function useCountUp(target: number | undefined, durationMs = 900): number | undefined {
  const [value, setValue] = useState<number | undefined>(undefined);
  const firstRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === undefined || !Number.isFinite(target)) return;

    if (
      firstRef.current !== null ||
      (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      // subsequent refresh or reduced motion — snap on the next frame
      // (async to avoid a synchronous cascading render)
      firstRef.current = target;
      const raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }

    firstRef.current = target;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return target === undefined ? undefined : value;
}

function StatCard({ stat, loading, span }: { stat: StatDef; loading: boolean; span?: boolean }) {
  const animated = useCountUp(stat.raw);
  const ready = !loading && stat.raw !== undefined && animated !== undefined;

  return (
    <div
      className={cn(
        "glass-card group px-3.5 py-3 transition-transform hover:-translate-y-0.5 hover:bg-card/80",
        span && "col-span-2 sm:col-span-1",
      )}
    >
      <div className="text-[11px] font-medium text-muted-foreground">{stat.label}</div>
      <div
        dir="ltr"
        className={cn(
          "mt-1 font-mono text-sm font-bold tracking-tight transition-colors",
          stat.accent && "text-primary",
          stat.up === true && "text-buy",
          stat.up === false && "text-sell",
          ready && "count-pop tabular-nums",
        )}
      >
        {ready ? stat.format(animated!) : loading ? "···" : "—"}
      </div>
    </div>
  );
}

/** Compact sparkline of last 30 daily closes. */
function MiniSparkline() {
  const { data, loading } = useMarket();
  const daily = data?.daily.slice(-30) ?? [];
  if (loading || daily.length < 2) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted/40" />;
  }
  const closes = daily.map((c) => c.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const W = 100;
  const H = 100;
  const pts = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * W;
    const y = H - ((c - min) / range) * (H - 8) - 4;
    return `${x},${y}`;
  });
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "var(--buy)" : "var(--sell)";
  return (
    <div className="chart-ltr">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full">
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill="url(#spark)" />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{fmt.price(min)}</span>
        <span>{fmt.price(max)}</span>
      </div>
    </div>
  );
}
