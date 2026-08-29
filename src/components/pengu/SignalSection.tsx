"use client";

/**
 * SignalSection — the product (v4 multi-timeframe).
 *
 * State machine (server-driven via /api/auth/session entitlements):
 *   not connected / not authenticated → connect CTA
 *   no active pass                    → locked preview + pass CTA
 *   active pass (any PASS_* tier)      → full signal card
 *
 * Layout follows the target plan §14: one primary BUY/SELL/WAIT verdict with
 * a 0–100 score, confidence, plus per-timeframe dots (15m / 1h / 4h / 1d).
 * The free layer always shows the live consensus teaser (factor counts +
 * timeframe dots) so visitors can verify the engine is real before paying.
 *
 * @module components/pengu/SignalSection
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { useMarket, fmt } from "./useMarket";
import { authFetch } from "@/lib/client-session";
import { PaymentDialog, type PaymentProduct } from "./PaymentDialog";
import { FactorList } from "./FactorList";
import { MoodGauge } from "./MoodGauge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Brain,
  Calendar,
  Gauge,
  Info,
  Loader2,
  Lock,
  PauseCircle,
  PenLine,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { passById, perDayPrice } from "@/lib/modules/access/passes";

type TfKey = "15m" | "1h" | "4h" | "1d";
type SignalAction = "BUY" | "SELL" | "WAIT";

interface TfResult {
  timeframe: TfKey;
  score: number;
  action: SignalAction;
  band: string;
  confidence: number;
  atr: number | null;
  atrPct: number | null;
  candlesUsed: number;
}

interface FullSignal {
  action: SignalAction;
  band: string;
  score: number;
  confidence: number;
  dataQuality: number;
  price: number;
  timeframes: Record<TfKey, TfResult>;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskReward: number | null;
  expectedRangeLow: number | null;
  expectedRangeHigh: number | null;
  volatilityWarning: boolean;
  volatility: number | null;
  factors: { key: string; score: number; weight: number; contribution: number }[];
  reasoning: { fa: string; en: string };
  candlesUsed: number;
}

interface PreviewData {
  day: string;
  consensus: { bullish: number; bearish: number; neutral: number; total: number };
  timeframes: { timeframe: TfKey; action: SignalAction }[];
  dataQuality: number;
  candlesUsed: number;
}

const TF_ORDER: TfKey[] = ["15m", "1h", "4h", "1d"];

export function SignalSection() {
  const { t, locale } = useI18n();
  const { entitlements, signingIn, login, signIn, loading: authLoading } = useAuth();
  const { data: market } = useMarket();
  const [product, setProduct] = useState<PaymentProduct | null>(null);

  const hasAccess = !!entitlements?.signalAccess;

  // free preview (public)
  const previewQuery = useQuery({
    queryKey: ["signal-preview"],
    queryFn: async (): Promise<PreviewData | null> => {
      const r = await fetch("/api/signal/preview", { cache: "no-store" });
      const d = await r.json();
      return d.ok ? d : null;
    },
    staleTime: 60_000,
    retry: 1,
  });
  const preview = previewQuery.data ?? null;

  // paid signal (pass-gated)
  const signalQuery = useQuery({
    queryKey: ["signal-today", entitlements?.signalAccess],
    queryFn: async (): Promise<{ signal: FullSignal } | { error: string }> => {
      const res = await authFetch("/api/signal/today", { cache: "no-store" });
      const data = await res.json();
      return data.ok ? { signal: data.signal } : { error: data.error ?? "ERROR" };
    },
    enabled: !!hasAccess,
    staleTime: 30_000,
    retry: 1,
  });
  const signal = signalQuery.data && "signal" in signalQuery.data ? signalQuery.data.signal : null;
  const signalError = signalQuery.data && "error" in signalQuery.data ? signalQuery.data.error : null;

  return (
    <section id="signal" className="scroll-mt-20 px-4 py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2.5 text-2xl font-black sm:text-3xl">
              <Brain className="size-7 text-primary" />
              {t("signal.title")}
            </h2>
            {preview && (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("signal.liveEngine")} · {preview.candlesUsed} {t("signal.candlesUsed")}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {market?.snapshot && (
              <Badge variant="outline" className="gap-1.5 px-3 py-1.5 font-mono" dir="ltr">
                PENGU ${fmt.price(market.snapshot.priceUsd)}
              </Badge>
            )}
            {entitlements?.activeGrant && (
              <Badge className="gap-1.5 bg-buy/15 px-3 py-1.5 text-buy ring-1 ring-buy/30">
                <Sparkles className="size-3.5" />
                {entitlements.activeGrant.lifetime ? (
                  <>{t("dashboard.lifetime")} ∞</>
                ) : (
                  <>
                    {t("signal.subscribed")} ·{" "}
                    {new Date(entitlements.activeGrant.expiresAt).toLocaleDateString(locale === "fa" ? "fa-IR" : "en-US")}
                  </>
                )}
              </Badge>
            )}
          </div>
        </header>

        {authLoading ? (
          <Skeleton className="h-80 w-full rounded-2xl" />
        ) : !entitlements?.authenticated ? (
          <ConnectGate />
        ) : !hasAccess ? (
          <PassGate onPay={(id, name, price) => setProduct({ id, name, pricePengu: price })} />
        ) : signal ? (
          <FullSignalCard signal={signal} locale={locale} />
        ) : signalError ? (
          <ErrorCard error={signalError} onRetry={() => signalQuery.refetch()} />
        ) : (
          <Skeleton className="h-80 w-full rounded-2xl" />
        )}

        {/* free consensus teaser (always visible when the full signal is not) */}
        {preview && !signal && (
          <div className="glass-card shimmer mt-6 p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-bold">{t("signal.consensus")}</span>
              <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                <Lock className="size-3" />
                {t("signal.previewNote")}
              </Badge>
            </div>
            <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,230px)_1fr]">
              {/* mood dial — the consensus as one glanceable needle */}
              <MoodGauge consensus={preview.consensus} />

              <div>
                {/* timeframe dots — the engine is alive on every horizon */}
                <div className="flex flex-wrap items-center gap-2">
                  {preview.timeframes.map((tf) => (
                    <span
                      key={tf.timeframe}
                      className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px] font-bold"
                    >
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          tf.action === "BUY" ? "bg-buy" : tf.action === "SELL" ? "bg-sell" : "bg-hold",
                        )}
                      />
                      {tf.timeframe.toUpperCase()}
                    </span>
                  ))}
                </div>
                <div className="relative mt-4 h-3.5 overflow-hidden rounded-full bg-muted/60" dir="ltr">
                  <div className="absolute inset-0 flex">
                    <div
                      className="bg-buy transition-all duration-500"
                      style={{ width: `${(preview.consensus.bullish / preview.consensus.total) * 100}%` }}
                    />
                    <div
                      className="bg-hold/60 transition-all duration-500"
                      style={{ width: `${(preview.consensus.neutral / preview.consensus.total) * 100}%` }}
                    />
                    <div
                      className="bg-sell transition-all duration-500"
                      style={{ width: `${(preview.consensus.bearish / preview.consensus.total) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-xs font-semibold" dir="ltr">
                  <span className="text-buy">🐂 {preview.consensus.bullish} {t("signal.bullish")}</span>
                  <span className="text-hold">≅ {preview.consensus.neutral} {t("signal.neutral")}</span>
                  <span className="text-sell">🐻 {preview.consensus.bearish} {t("signal.bearish")}</span>
                </div>
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                  {t("signal.mood.desc")}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <PaymentDialog key={product?.id ?? "none"} product={product} onClose={() => setProduct(null)} />
    </section>
  );
}

/* ---------------------------- gates ---------------------------- */

function ConnectGate() {
  const { t } = useI18n();
  const { login, signIn, signingIn, walletStatus } = useAuth();
  const connected = walletStatus === "connected";
  return (
    <div className="glass-card flex flex-col items-center gap-5 px-6 py-14 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-primary/15 text-primary ring-2 ring-primary/30">
        {/* accurate affordance: wallet = connect step, pen = sign-in step */}
        {connected ? <PenLine className="size-8" /> : <Wallet className="size-8" />}
      </span>
      {/* copy must match the actual state — "connect your wallet" while the
          wallet is already connected reads as a sync bug to the user */}
      <p className="max-w-md text-lg font-bold">
        {connected ? t("signal.signInFirst") : t("signal.connectFirst")}
      </p>
      {connected ? (
        <Button onClick={() => signIn()} size="lg" disabled={signingIn} className="gap-2 font-bold">
          {signingIn && <Loader2 className="size-5 animate-spin" />}
          {signingIn ? t("wallet.signing") : t("wallet.signInTitle")}
        </Button>
      ) : (
        <Button onClick={login} size="lg" className="gap-2 px-8 font-bold">
          <Wallet className="size-5" />
          {t("nav.connect")}
        </Button>
      )}
      <p className="max-w-sm text-xs leading-6 text-muted-foreground">{t("faq.a1")}</p>
    </div>
  );
}

function PassGate({ onPay }: { onPay: (id: string, name: string, price: number) => void }) {
  const { t } = useI18n();
  // prices come from the shared catalog (lib/modules/access/passes.ts) —
  // the same source the server verifies payments against
  const week = passById("PASS_7D")!;
  const month = passById("PASS_30D")!;
  return (
    <div className="glass-card flex flex-col items-center gap-5 px-6 py-12 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-hold/15 text-hold ring-2 ring-hold/30">
        <Lock className="size-8" />
      </span>
      <p className="max-w-md text-lg font-bold">{t("signal.needPass")}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t("signal.needPassDesc")}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          onClick={() => onPay("PASS_7D", t("products.pass7d.name"), week.pricePengu)}
          size="lg"
          className="gap-2 font-bold"
        >
          <Sparkles className="size-5" />
          {t("products.pass7d.name")} — {week.pricePengu} PENGU
        </Button>
        <Button
          onClick={() => onPay("PASS_30D", t("products.pass30d.name"), month.pricePengu)}
          size="lg"
          variant="outline"
          className="gap-2 font-bold"
        >
          <Calendar className="size-5" />
          {t("products.pass30d.name")} — {month.pricePengu} PENGU
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {perDayPrice(month) ? `≈ ${perDayPrice(month)} PENGU / ${t("common.day")}` : null}
      </p>
      <a
        href="#pricing"
        className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t("signal.viewPlans")} →
      </a>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="glass-card flex flex-col items-center gap-4 px-6 py-12 text-center">
      <span className="text-4xl">🐧💨</span>
      <p className="font-bold">{error === "INSUFFICIENT_HISTORY" ? t("track.empty") : t("common.error")}</p>
      <Button onClick={onRetry} variant="outline" className="gap-2">
        {t("common.retry")}
      </Button>
    </div>
  );
}

/* ------------------------- full signal ------------------------- */

const actionText = (a: SignalAction) => (a === "BUY" ? "text-buy" : a === "SELL" ? "text-sell" : "text-hold");
const actionBg = (a: SignalAction) => (a === "BUY" ? "bg-buy" : a === "SELL" ? "bg-sell" : "bg-hold");

function FullSignalCard({ signal, locale }: { signal: FullSignal; locale: string }) {
  const { t } = useI18n();
  const ActionIcon =
    signal.action === "BUY" ? ArrowUpToLine : signal.action === "SELL" ? ArrowDownToLine : PauseCircle;
  // band = the five-band nuance behind the three-state verdict (plan §4)
  const bandLabel = t(`signal.band.${signal.band}`);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* left: verdict */}
        <div className="glass-card relative overflow-hidden p-6">
          <div className={cn("absolute inset-x-0 top-0 h-1", actionBg(signal.action))} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground">{t("signal.action")}</div>
              <div className={cn("mt-1 flex items-center gap-2.5 text-4xl font-black tracking-tight", actionText(signal.action))}>
                <ActionIcon className="size-9" />
                {t(`signal.${signal.action}`)}
              </div>
              <Badge variant="outline" className="mt-1.5 text-[10px] font-bold text-muted-foreground">
                {bandLabel}
              </Badge>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-muted-foreground">{t("signal.signalScore")}</div>
              <div className="font-mono text-3xl font-black" dir="ltr">
                {Math.round(signal.score)}
                <span className="text-base text-muted-foreground">/100</span>
              </div>
            </div>
          </div>

          {/* 0-100 score bar (50 = neutral centre mark) */}
          <div className="mt-4">
            <div className="relative h-2.5 overflow-hidden rounded-full bg-muted/60" dir="ltr">
              <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <div
                className={cn("absolute top-0 h-full", actionBg(signal.action))}
                style={
                  signal.score >= 50
                    ? { left: "50%", width: `${Math.min(50, signal.score - 50)}%` }
                    : { right: "50%", width: `${Math.min(50, 50 - signal.score)}%` }
                }
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" dir="ltr">
              <span>0 · SELL</span>
              <span>50</span>
              <span>BUY · 100</span>
            </div>
          </div>

          {/* confidence gauge */}
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 font-semibold">
                <Gauge className="size-3.5" />
                {t("signal.confidence")}
              </span>
              <span className="font-mono font-bold">{signal.confidence}%</span>
            </div>
            <Progress value={signal.confidence} className="h-2.5" />
            <div className="mt-1 text-[10px] text-muted-foreground">
              data quality: {(signal.dataQuality * 100).toFixed(0)}% · {signal.candlesUsed} {t("signal.candlesUsed")}
            </div>
          </div>

          {/* volatility warning (plan §16 — honest risk note) */}
          {signal.volatilityWarning && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-hold/30 bg-hold/10 px-3 py-2 text-[11px] font-semibold text-hold">
              <TriangleAlert className="size-4 shrink-0" />
              {t("signal.volatilityWarning")}
            </div>
          )}

          {/* timeframe grid — one verdict per horizon (plan §14) */}
          <div className="mt-5 grid grid-cols-4 gap-2">
            {TF_ORDER.map((tf) => {
              const r = signal.timeframes[tf];
              if (!r) return null;
              return (
                <Tooltip key={tf}>
                  <TooltipTrigger asChild>
                    <div className="rounded-lg border border-border/40 bg-muted/20 px-2 py-2 text-center transition-colors hover:border-primary/30">
                      <div className="text-[10px] font-bold text-muted-foreground">{tf.toUpperCase()}</div>
                      <div className={cn("mt-0.5 text-xs font-black", actionText(r.action))}>
                        {t(`signal.${r.action}`)}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground" dir="ltr">
                        {Math.round(r.score)}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {t("signal.tfScore")}: {r.score}/100 · {t("signal.confidence")}: {r.confidence}%
                    {r.atrPct !== null ? ` · ATR ${r.atrPct}%` : ""}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {/* levels grid (only meaningful when action is actionable) */}
          {signal.action !== "WAIT" && (
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <Level
                label={t("signal.entryZone")}
                value={signal.entryLow && signal.entryHigh ? `${fmt.price(signal.entryLow)} – ${fmt.price(signal.entryHigh)}` : null}
              />
              <Level label={t("signal.stopLoss")} value={fmt.price(signal.stopLoss)} danger />
              <Level label={t("signal.takeProfit1")} value={fmt.price(signal.takeProfit1)} good />
              <Level label={t("signal.takeProfit2")} value={fmt.price(signal.takeProfit2)} good />
              <Level
                label={t("signal.expectedRange")}
                value={
                  signal.expectedRangeLow && signal.expectedRangeHigh
                    ? `${fmt.price(signal.expectedRangeLow)} – ${fmt.price(signal.expectedRangeHigh)}`
                    : null
                }
              />
              <Level
                label={t("signal.riskReward")}
                value={signal.riskReward ? `1 : ${signal.riskReward.toFixed(2)}` : null}
              />
            </div>
          )}
        </div>

        {/* right: factors + reasoning */}
        <div className="glass-card p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Target className="size-4 text-primary" />
            {t("signal.factors")}
            <Badge variant="outline" className="ms-1 text-[10px] text-muted-foreground">4H</Badge>
          </h3>
          <FactorList factors={signal.factors} className="mt-3 max-h-72 overflow-y-auto pe-1 nice-scroll" />

          <h3 className="mt-5 flex items-center gap-2 text-sm font-bold">
            <Brain className="size-4 text-primary" />
            {t("signal.reasoning")}
          </h3>
          <p className="mt-2 rounded-xl border border-border/50 bg-muted/20 p-4 text-[13px] leading-7">
            {signal.reasoning[locale === "fa" ? "fa" : "en"]}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Info className="size-3" />
            {t("footer.disclaimer")}
          </p>
        </div>
      </div>
    </TooltipProvider>
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
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div
        dir="ltr"
        className={cn(
          "mt-0.5 font-mono text-sm font-bold",
          good && "text-buy",
          danger && "text-sell",
        )}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}
