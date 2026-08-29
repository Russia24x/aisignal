"use client";

/**
 * SignalDetailDialog — public drill-down into one PAST day's signal,
 * opened by clicking a row in the track record.
 *
 * Lazy-loads /api/signal/detail?day=… on open (cached per day), then
 * renders the full stored engine output: verdict header, confidence,
 * risk levels, the shared FactorList (with education tooltips) and the
 * localized reasoning paragraph. Outcome footer shows what actually
 * happened to the price after the signal (T+24h evaluation).
 *
 * @module components/pengu/SignalDetailDialog
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { fmt } from "./useMarket";
import { FactorList } from "./FactorList";
import { ActionBadge, OutcomeBadge } from "./TrackRecord";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Brain, Gauge, Info, Target, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Detail {
  day: string;
  action: string;
  band: string;
  score: number;
  confidence: number;
  dataQuality: number;
  price: number;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  expectedRangeLow: number | null;
  expectedRangeHigh: number | null;
  atr: number | null;
  factors: { key: string; score: number; weight: number; contribution: number }[];
  reasoning: { fa: string; en: string };
  candlesUsed: number;
  outcome: string;
  outcomePrice: number | null;
  priceChangePct: number | null;
}

interface ErrorEntry {
  kind: "ERROR";
  /** transient errors expire — a later re-open retries instead of showing
   *  a stale failure forever (one network blip must not break a day) */
  at: number;
}

const cache = new Map<string, Detail | ErrorEntry>();
const ERROR_TTL_MS = 30_000;

function getCacheEntry(day: string): Detail | "ERROR" | undefined {
  const e = cache.get(day);
  if (e && typeof e === "object" && "kind" in e) {
    // ErrorEntry — expire stale failures so a later re-open retries
    if (Date.now() - e.at > ERROR_TTL_MS) {
      cache.delete(day);
      return undefined;
    }
    return "ERROR";
  }
  return e as Detail | undefined;
}

export function SignalDetailDialog({ day, onClose }: { day: string | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const initial = day ? getCacheEntry(day) : undefined;
  const [detail, setDetail] = useState<Detail | null>(initial && initial !== "ERROR" ? initial : null);
  const [failed, setFailed] = useState(initial === "ERROR");

  useEffect(() => {
    if (!day) return;
    const cached = getCacheEntry(day);
    if (cached === "ERROR") {
      // deferred to the next frame — no synchronous cascading render
      const raf = requestAnimationFrame(() => {
        setDetail(null);
        setFailed(true);
      });
      return () => cancelAnimationFrame(raf);
    }
    if (cached) {
      const raf = requestAnimationFrame(() => {
        setDetail(cached);
        setFailed(false);
      });
      return () => cancelAnimationFrame(raf);
    }
    let alive = true;
    const raf = requestAnimationFrame(() => {
      if (!alive) return;
      setDetail(null);
      setFailed(false);
      fetch(`/api/signal/detail?day=${day}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (d.ok) {
            cache.set(day, d.signal);
            setDetail(d.signal);
          } else {
            // 4xx from the API (bad day, paywalled) is a REAL error — cache
            // it briefly so rapid re-clicks don't refetch, but let it expire
            cache.set(day, { kind: "ERROR", at: Date.now() });
            setFailed(true);
          }
        })
        .catch(() => {
          // network failure — do NOT cache at all (retry on next open)
          if (alive) setFailed(true);
        });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [day]);

  const won = detail?.outcome === "WIN";
  const up = (detail?.priceChangePct ?? 0) >= 0;

  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-card nice-scroll max-h-[85vh] max-w-md overflow-y-auto border-border/70 sm:max-w-2xl" dir="auto">
        {/* action-colored accent strip — matches the live signal card */}
        {detail && (
          <div
            aria-hidden
            className={cn(
              "absolute inset-x-0 top-0 h-1",
              detail.action === "BUY" ? "bg-buy" : detail.action === "SELL" ? "bg-sell" : "bg-hold",
            )}
          />
        )}
        {day && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2.5 text-lg font-extrabold">
                <span className="font-mono" dir="ltr">
                  {day}
                </span>
                {detail ? (
                  <>
                    <ActionBadge action={detail.action} />
                    <OutcomeBadge outcome={detail.outcome} />
                  </>
                ) : null}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {t("track.detailTitle")} · {t("track.subtitle")}
              </DialogDescription>
            </DialogHeader>

            {!detail ? (
              failed ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("track.detailError")}</p>
              ) : (
                <div className="space-y-3 py-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-32 w-full" />
                  <p className="text-center text-xs text-muted-foreground">{t("track.loadingDetail")}</p>
                </div>
              )
            ) : (
              <TooltipProvider delayDuration={200}>
                {/* verdict + confidence */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground">{t("signal.signalScore")}</div>
                    <div
                      dir="ltr"
                      className={cn(
                        "font-mono text-2xl font-black",
                        detail.score > 55 ? "text-buy" : detail.score < 45 ? "text-sell" : "text-hold",
                      )}
                    >
                      {Math.round(detail.score)}<span className="text-sm text-muted-foreground">/100</span>
                    </div>
                  </div>
                  <div className="min-w-40 flex-1">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1 font-semibold">
                        <Gauge className="size-3" />
                        {t("signal.confidence")}
                      </span>
                      <span className="font-mono font-bold">{detail.confidence}%</span>
                    </div>
                    <Progress value={detail.confidence} className="h-2" />
                    <div className="mt-1 text-[9px] text-muted-foreground">
                      data quality: {(detail.dataQuality * 100).toFixed(0)}% · {detail.candlesUsed} {t("signal.candlesUsed")}
                    </div>
                  </div>
                </div>

                {/* outcome strip — what actually happened */}
                {detail.outcomePrice !== null && (
                  <div
                    className={cn(
                      "mt-3 flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
                      won ? "border-buy/30 bg-buy/10" : "border-sell/30 bg-sell/10",
                    )}
                  >
                    <div className="flex items-center gap-2 text-xs font-bold">
                      {up ? (
                        <TrendingUp className={cn("size-4", up && "text-buy")} />
                      ) : (
                        <TrendingDown className={cn("size-4", !up && "text-sell")} />
                      )}
                      {t("track.priceMove")}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs" dir="ltr">
                      <span className="text-muted-foreground">
                        {fmt.price(detail.price)} → {fmt.price(detail.outcomePrice)}
                      </span>
                      <span className={cn("text-sm font-black", up ? "text-buy" : "text-sell")}>
                        {detail.priceChangePct !== null ? fmt.pct(detail.priceChangePct) : "—"}
                      </span>
                    </div>
                  </div>
                )}

                {/* levels */}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Level
                    label={t("signal.entryZone")}
                    value={
                      detail.entryLow !== null && detail.entryHigh !== null
                        ? `${fmt.price(detail.entryLow)}–${fmt.price(detail.entryHigh)}`
                        : null
                    }
                  />
                  <Level label={t("signal.stopLoss")} value={fmt.price(detail.stopLoss)} danger />
                  <Level label={t("signal.takeProfit1")} value={fmt.price(detail.takeProfit1)} good />
                  <Level label={t("signal.takeProfit2")} value={fmt.price(detail.takeProfit2)} good />
                  <Level
                    label={t("signal.expectedRange")}
                    value={
                      detail.expectedRangeLow !== null && detail.expectedRangeHigh !== null
                        ? `${fmt.price(detail.expectedRangeLow)}–${fmt.price(detail.expectedRangeHigh)}`
                        : null
                    }
                  />
                  <Level
                    label={t("signal.riskReward")}
                    value={detail.riskReward ? `1 : ${detail.riskReward.toFixed(2)}` : null}
                  />
                </div>

                {/* factors */}
                <h3 className="mt-4 flex items-center gap-2 text-sm font-bold">
                  <Target className="size-4 text-primary" />
                  {t("signal.factors")}
                </h3>
                <FactorList factors={detail.factors} className="mt-2 max-h-64 overflow-y-auto pe-1 nice-scroll" />

                {/* reasoning */}
                <h3 className="mt-4 flex items-center gap-2 text-sm font-bold">
                  <Brain className="size-4 text-primary" />
                  {t("signal.reasoning")}
                </h3>
                <p className="mt-2 rounded-xl border border-border/50 bg-muted/20 p-4 text-[13px] leading-7">
                  {detail.reasoning[locale === "fa" ? "fa" : "en"] || detail.reasoning.en}
                </p>
                <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Info className="size-3" />
                  {t("footer.disclaimer")}
                </p>
              </TooltipProvider>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Level({
  label,
  value,
  good,
  danger,
}: {
  label: string;
  value: string | null;
  good?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
      <div className="truncate text-[10px] font-medium text-muted-foreground">{label}</div>
      <div
        dir="ltr"
        className={cn("mt-0.5 font-mono text-xs font-bold", good && "text-buy", danger && "text-sell")}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}
