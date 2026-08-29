"use client";

/**
 * PriceChart — interactive daily/hourly price chart (recharts).
 * Data: server-provided real candles (CoinGecko OHLC).
 *
 * @module components/pengu/PriceChart
 */
import { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMarket, fmt } from "./useMarket";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

export function PriceChart() {
  const { t, locale } = useI18n();
  const { data, loading } = useMarket();
  const [mode, setMode] = useState<"daily" | "hourly">("daily");

  const chartData = useMemo(() => {
    const candles = mode === "daily" ? data?.daily.slice(-90) : data?.hourly.slice(-48);
    if (!candles) return [];
    return candles.map((c) => ({
      time: c.t,
      price: c.c,
      label:
        mode === "daily"
          ? new Date(c.t).toLocaleDateString(locale === "fa" ? "fa-IR" : "en-US", { month: "short", day: "numeric" })
          : new Date(c.t).toLocaleTimeString(locale === "fa" ? "fa-IR" : "en-US", { hour: "2-digit", minute: "2-digit" }),
    }));
  }, [data, mode, locale]);

  const prices = chartData.map((d) => d.price);
  const up = prices.length > 1 && prices[prices.length - 1] >= prices[0];
  const color = up ? "var(--buy)" : "var(--sell)";

  // visible-window range summary (Low / High / current position percentile)
  const range = useMemo(() => {
    if (prices.length < 2) return null;
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const last = prices[prices.length - 1];
    const span = high - low;
    const pos = span > 0 ? Math.round(((last - low) / span) * 100) : 50;
    return { low, high, last, pos };
  }, [prices]);

  return (
    <section id="chart" className="scroll-mt-20 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="glass-card p-5 pb-3 sm:p-6 sm:pb-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">PENGU / USD</h2>
              <p className="text-xs text-muted-foreground">
                {t("chart.price")} · CoinGecko OHLC · {mode === "daily" ? t("chart.dailyRange") : t("chart.hourlyRange")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {range && (
                <div
                  className="hidden items-center gap-2 rounded-full border border-border/60 bg-background/40 px-3 py-1 font-mono text-[11px] sm:flex"
                  dir="ltr"
                  aria-label={`${t("chart.low")} ${fmt.price(range.low)}, ${t("chart.high")} ${fmt.price(range.high)}`}
                >
                  <span className="text-sell">
                    {t("chart.low")} {fmt.price(range.low)}
                  </span>
                  <span className="text-muted-foreground/40" aria-hidden>·</span>
                  <span className="text-buy">
                    {t("chart.high")} {fmt.price(range.high)}
                  </span>
                  <span className="text-muted-foreground/40" aria-hidden>·</span>
                  <span
                    className="font-semibold text-primary"
                    title={t("chart.position")}
                  >
                    {range.pos}%
                  </span>
                </div>
              )}
              <Tabs value={mode} onValueChange={(v) => setMode(v as "daily" | "hourly")}>
                <TabsList className="h-9">
                  <TabsTrigger value="daily" className="text-xs font-bold">
                    {t("chart.daily")} · 90d
                  </TabsTrigger>
                  <TabsTrigger value="hourly" className="text-xs font-bold">
                    {t("chart.hourly")} · 48h
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          {loading || chartData.length < 2 ? (
            <Skeleton className="h-72 w-full rounded-xl" />
          ) : (
            <div className="chart-ltr h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v: number) => `$${v.toFixed(4)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.15 0.03 218 / 0.92)",
                      border: "1px solid oklch(0.4 0.06 200 / 0.45)",
                      borderRadius: "12px",
                      backdropFilter: "blur(12px)",
                      boxShadow: "0 8px 32px oklch(0 0 0 / 0.45)",
                      padding: "8px 12px",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "var(--muted-foreground)" }}
                    itemStyle={{ color: "var(--foreground)" }}
                    formatter={(value: number | string) => [fmt.price(Number(value)), "PENGU"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke={color}
                    strokeWidth={2}
                    fill="url(#chartFill)"
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, fill: color, stroke: "var(--background)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
