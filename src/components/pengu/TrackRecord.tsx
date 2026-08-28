"use client";

/**
 * TrackRecord — public table of past signals with real outcomes.
 * Built from the Signal table (auto-evaluated T+24h). No demo data:
 * starts empty and fills as days pass.
 *
 * Pagination: fetches pages of 30 with a "Load more" button; stats, the
 * shown/total counter and the equity curve always reflect the ENTIRE
 * history (curve + stats are computed server-side over all rows).
 *
 * Visuals:
 *  - WinRateRing: animated circular progress for the win rate
 *  - EquityCurve: cumulative strategy-return sparkline (SVG area chart,
 *    zero baseline, gradient fill, end-point marker)
 *  - P&L simulator: "stake X PENGU per signal" → final value from the curve
 *  - rows are clickable → SignalDetailDialog (full per-day breakdown)
 *
 * @module components/pengu/TrackRecord
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { fmt } from "./useMarket";
import { SignalDetailDialog } from "./SignalDetailDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calculator, ChevronLeft, History, Loader2, MousePointerClick, TrendingUp, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;

interface Item {
  day: string;
  action: string;
  confidence: number;
  priceAtSignal: number;
  outcome: string;
  outcomePrice: number | null;
  priceChangePct: number | null;
}

interface Stats {
  total: number;
  closed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgConfidence: number;
}

interface CurvePoint {
  day: string;
  cum: number;
}

export function TrackRecord() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [curve, setCurve] = useState<CurvePoint[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [detailDay, setDetailDay] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/signal/history?limit=${PAGE_SIZE}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setItems(d.items);
          setStats(d.stats);
          setCurve(d.curve ?? []);
          setTotal(d.total ?? d.items.length);
        } else setError(true);
      })
      .catch(() => {
        setItems([]);
        setError(true);
      });
  }, []);

  const loadMore = useCallback(async () => {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/signal/history?limit=${PAGE_SIZE}&offset=${items.length}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (d.ok) {
        // merge, dedupe by day (safety against races)
        const seen = new Set(items.map((i) => i.day));
        setItems([...items, ...(d.items as Item[]).filter((i) => !seen.has(i.day))]);
        setStats(d.stats);
        setCurve(d.curve ?? []);
        setTotal(d.total ?? 0);
      }
    } catch {
      /* keep current list; next click retries */
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore]);

  const hasMore = items !== null && items.length < total;
  const hasCurve = (curve?.length ?? 0) >= 2;
  const finalCum = curve && curve.length > 0 ? curve[curve.length - 1].cum : 0;

  return (
    <section id="track" className="scroll-mt-20 px-4 py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h2 className="flex items-center gap-2.5 text-2xl font-black sm:text-3xl">
            <Trophy className="size-7 text-primary" />
            {t("track.title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("track.subtitle")}</p>
        </header>

        {/* performance panel: win-rate ring + equity curve + stat cards */}
        {stats && (
          <div className="glass-card mb-5 p-4 sm:p-5">
            <div className="grid items-center gap-5 lg:grid-cols-[auto_1fr]">
              {/* Win-rate ring */}
              <WinRateRing
                value={stats.winRate}
                closed={stats.closed}
                label={t("track.winRate")}
              />

              {/* Equity curve */}
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                    <TrendingUp className="size-3.5 text-primary" />
                    {t("track.curve")}
                  </span>
                  {hasCurve && (
                    <span
                      dir="ltr"
                      className={cn(
                        "rounded-full px-2.5 py-0.5 font-mono text-xs font-black ring-1",
                        finalCum >= 0
                          ? "bg-buy/10 text-buy ring-buy/30"
                          : "bg-sell/10 text-sell ring-sell/30",
                      )}
                    >
                      {finalCum >= 0 ? "+" : ""}
                      {finalCum.toFixed(1)}%
                    </span>
                  )}
                </div>
                {hasCurve ? (
                  <EquityCurve points={curve!} />
                ) : (
                  <div className="grid h-28 place-items-center rounded-xl border border-dashed border-border/60 bg-card/30 px-4 text-center">
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {t("track.curveEmpty")}
                    </p>
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">{t("track.curveHint")}</p>
              </div>
            </div>

            {/* P&L simulator — "stake X per signal" from the real curve */}
            {hasCurve && <PnlSimulator curve={curve!} />}

            {/* stat cards */}
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border/50 pt-4">
              <StatCard label={t("track.closedSignals")} value={String(stats.closed)} />
              <StatCard label={t("track.avgConfidence")} value={`${stats.avgConfidence}%`} />
              <StatCard label={t("signal.day")} value={String(stats.total)} />
            </div>
          </div>
        )}

        {/* table */}
        <div className="glass-card overflow-hidden">
          {items === null ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : items.length === 0 ? (
            <div className="empty-grid relative px-6 py-14 text-center">
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary ring-2 ring-primary/30">
                <Trophy className="size-6" />
              </div>
              <p className="text-sm font-bold">🐧 {t("track.empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("track.subtitle")}</p>
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "nice-scroll snap-y snap-proximity overflow-y-auto",
                  // paginated → compact 28rem scroll area; single page → taller
                  // 40rem cap so typical lists render without a half-cut row
                  hasMore ? "max-h-[28rem]" : "max-h-[40rem]",
                )}
              >
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-popover/95 backdrop-blur">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs">{t("track.day")}</TableHead>
                      <TableHead className="text-xs">{t("track.action")}</TableHead>
                      <TableHead className="text-xs">{t("signal.confidence")}</TableHead>
                      <TableHead className="text-xs">{t("track.priceAtSignal")}</TableHead>
                      <TableHead className="text-xs">{t("track.change")}</TableHead>
                      <TableHead className="text-xs">{t("track.outcome")}</TableHead>
                      <TableHead className="w-8" aria-label={t("track.detailTitle")} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it) => (
                      <TableRow
                        key={it.day}
                        onClick={() => setDetailDay(it.day)}
                        className="cursor-pointer snap-start text-xs transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none"
                      >
                        <TableCell className="font-mono font-semibold">{it.day}</TableCell>
                        <TableCell>
                          <ActionBadge action={it.action} />
                        </TableCell>
                        <TableCell className="font-mono">{it.confidence}%</TableCell>
                        <TableCell className="font-mono" dir="ltr">
                          {fmt.price(it.priceAtSignal)}
                        </TableCell>
                        <TableCell
                          dir="ltr"
                          className={cn(
                            "font-mono font-bold",
                            (it.priceChangePct ?? 0) >= 0 ? "text-buy" : "text-sell",
                          )}
                        >
                          {it.priceChangePct !== null ? fmt.pct(it.priceChangePct) : "—"}
                        </TableCell>
                        <TableCell>
                          <OutcomeBadge outcome={it.outcome} />
                        </TableCell>
                        <TableCell>
                          <ChevronLeft
                            className="size-3.5 text-muted-foreground/50 rtl:rotate-0 ltr:rotate-180"
                            aria-hidden
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* pagination footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-card/30 px-4 py-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <MousePointerClick className="size-3.5" />
                  {t("track.detailHint")}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <History className="size-3.5" />
                  {t("track.showing", { shown: String(items.length), total: String(total) })}
                </span>
                {hasMore && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="gap-1.5 px-4 font-bold"
                  >
                    {loadingMore ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <History className="size-3.5" />
                    )}
                    {loadingMore ? t("track.loadingMore") : t("track.loadMore")}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        {error && items !== null && items.length === 0 && (
          <p className="mt-3 text-center text-xs text-muted-foreground">{t("common.error")}</p>
        )}
      </div>

      <SignalDetailDialog day={detailDay} onClose={() => setDetailDay(null)} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* WinRateRing — animated circular progress                            */
/* ------------------------------------------------------------------ */

function WinRateRing({
  value,
  closed,
  label,
}: {
  value: number;
  closed: number;
  label: string;
}) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const pct = Math.min(Math.max(value, 0), 100);
  const color = pct >= 60 ? "var(--buy)" : pct >= 40 ? "var(--primary)" : "var(--sell)";

  return (
    <div
      className="relative grid size-28 shrink-0 place-items-center"
      role="img"
      aria-label={`${label}: ${pct}% (${closed})`}
    >
      <svg viewBox="0 0 80 80" className="size-28 -rotate-90">
        {/* track */}
        <circle cx="40" cy="40" r={R} fill="none" stroke="var(--border)" strokeWidth="7" opacity="0.5" />
        {/* progress */}
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C - (pct / 100) * C}
          style={{
            transition: "stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: `drop-shadow(0 0 6px ${color}55)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="font-mono text-xl font-black leading-none" dir="ltr">
            {pct}%
          </div>
          <div className="mt-1 text-[9px] font-bold text-muted-foreground">{label}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EquityCurve — cumulative strategy return sparkline (SVG)            */
/* ------------------------------------------------------------------ */

function EquityCurve({ points }: { points: CurvePoint[] }) {
  const { t } = useI18n();
  const W = 640;
  const H = 112;
  const PAD = 6;

  const path = useMemo(() => {
    const n = points.length;
    const xs = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
    const min = Math.min(0, ...points.map((p) => p.cum));
    const max = Math.max(0, ...points.map((p) => p.cum));
    const span = max - min || 1;
    const ys = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(p.cum).toFixed(1)}`).join(" ");
    const zeroY = ys(0);
    const area = `${line} L${xs(n - 1).toFixed(1)},${zeroY.toFixed(1)} L${xs(0).toFixed(1)},${zeroY.toFixed(1)} Z`;
    const last = points[n - 1];
    return { line, area, zeroY, lastX: xs(n - 1), lastY: ys(last.cum), positive: last.cum >= 0 };
  }, [points]);

  const stroke = path.positive ? "var(--buy)" : "var(--sell)";

  return (
    <div
      className="overflow-hidden rounded-xl border border-border/60 bg-card/30"
      dir="ltr"
      title={`${t("track.curve")}: ${path.positive ? "+" : ""}${points[points.length - 1].cum.toFixed(1)}%`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none" role="img" aria-label={t("track.curve")}>
        <defs>
          <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* zero baseline */}
        <line
          x1={PAD}
          x2={W - PAD}
          y1={path.zeroY}
          y2={path.zeroY}
          stroke="var(--muted-foreground)"
          strokeOpacity="0.35"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        {/* area + line */}
        <path d={path.area} fill="url(#equity-fill)" />
        <path
          d={path.line}
          fill="none"
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${path.positive ? "var(--buy)" : "var(--sell)"}44)` }}
        />
        {/* end-point marker */}
        <circle cx={path.lastX} cy={path.lastY} r="3.4" fill={stroke} />
        <circle cx={path.lastX} cy={path.lastY} r="6.5" fill={stroke} opacity="0.25" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PnlSimulator — "if you had staked X PENGU on every signal"          */
/* ------------------------------------------------------------------ */

const SIM_PRESETS = [10, 50, 100, 500];

function PnlSimulator({ curve }: { curve: CurvePoint[] }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(100);

  const { finalValue, profit } = useMemo(() => {
    const cum = curve[curve.length - 1].cum;
    const final = amount * (1 + cum / 100);
    return { finalValue: Math.round(final * 100) / 100, profit: Math.round((final - amount) * 100) / 100 };
  }, [curve, amount]);

  const positive = profit >= 0;

  return (
    <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold">
          <Calculator className="size-3.5 text-primary" />
          {t("track.simTitle")}
        </span>
        <div className="flex items-center gap-1.5" dir="ltr">
          {SIM_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(p)}
              className={cn(
                "rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ring-1 transition-all",
                amount === p
                  ? "bg-primary/20 text-primary ring-primary/50"
                  : "text-muted-foreground ring-border/60 hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={1000000}
            value={amount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setAmount(Number.isFinite(v) && v > 0 ? Math.min(v, 1000000) : 1);
            }}
            aria-label={t("track.simAmount")}
            className="w-24 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1 font-mono text-xs font-bold tabular-nums outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            dir="ltr"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="text-[11px] text-muted-foreground">
          {t("track.simAmount")}: <span className="font-mono font-bold text-foreground" dir="ltr">{amount.toLocaleString("en-US")} PENGU</span>
        </div>
        <div className="text-left" dir="ltr">
          <span className="text-[10px] text-muted-foreground">{t("track.simFinal")}</span>
          <div className="flex items-baseline gap-2 font-mono">
            <span className="text-xl font-black tabular-nums">{finalValue.toLocaleString("en-US")}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-black ring-1",
                positive ? "bg-buy/10 text-buy ring-buy/30" : "bg-sell/10 text-sell ring-sell/30",
              )}
            >
              {positive ? "+" : ""}
              {profit.toLocaleString("en-US")} PENGU
            </span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground/70">{t("track.simNote")}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard                                                            */
/* ------------------------------------------------------------------ */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card/70 hover:shadow-[0_4px_20px_-6px_var(--primary-glow,rgba(45,212,191,0.25))]">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-black" dir="ltr">
        {value}
      </div>
    </div>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const { t } = useI18n();
  const cls =
    action === "BUY"
      ? "bg-buy/15 text-buy ring-buy/30"
      : action === "SELL"
        ? "bg-sell/15 text-sell ring-sell/30"
        : "bg-hold/15 text-hold ring-hold/30";
  return (
    <Badge variant="outline" className={cn("px-2 font-black", cls)}>
      {t(`signal.${action}`)}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const { t } = useI18n();
  const cls =
    outcome === "WIN"
      ? "bg-buy/15 text-buy ring-buy/30"
      : outcome === "LOSS"
        ? "bg-sell/15 text-sell ring-sell/30"
        : "bg-muted text-muted-foreground ring-border";
  return (
    <Badge variant="outline" className={cn("px-2 font-bold", cls)}>
      {t(`track.${outcome}`)}
    </Badge>
  );
}
