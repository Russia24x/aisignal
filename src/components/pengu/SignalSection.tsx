"use client";

/**
 * SignalSection — the product.
 *
 * State machine (server-driven via /api/auth/session entitlements):
 *   not connected / not authenticated → connect CTA
 *   no active pass                    → locked preview + pass CTA
 *   active pass (any PASS_* tier)      → full signal card
 *
 * The free layer always shows the live consensus teaser so visitors can
 * verify the engine is real before paying. Entry and browsing are free
 * (v2 access model) — only signal CONTENT requires an access pass.
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
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { passById } from "@/lib/modules/access/passes";

interface FullSignal {
  action: "BUY" | "SELL" | "HOLD";
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
  support: number | null;
  resistance: number | null;
  atr: number | null;
  volatility: number | null;
  factors: { key: string; score: number; weight: number; contribution: number }[];
  reasoning: { fa: string; en: string };
  candlesUsed: number;
}

interface PreviewData {
  day: string;
  consensus: { bullish: number; bearish: number; neutral: number; total: number };
  dataQuality: number;
  candlesUsed: number;
}

export function SignalSection() {
  const { t, locale } = useI18n();
  const { walletStatus, entitlements, signingIn, login, signIn, loading: authLoading } = useAuth();
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
    staleTime: 60_000,
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
                {t("signal.day")}: <span className="font-mono font-bold">{preview.day}</span> ·{" "}
                {preview.candlesUsed} {t("signal.candlesUsed")}
              </p>
            )}
          </div>
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

        {/* free consensus teaser (always visible) */}
        {preview && !signal && (
          <div className="glass-card shimmer mt-6 p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold">{t("signal.consensus")}</span>
              <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                <Lock className="size-3" />
                {t("signal.previewNote")}
              </Badge>
            </div>
            <div className="relative h-3.5 overflow-hidden rounded-full bg-muted/60" dir="ltr">
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
          <Badge className="ms-1 bg-buy/15 text-buy hover:bg-buy/15" variant="secondary">
            −{week.discountPct}%
          </Badge>
        </Button>
        <Button
          onClick={() => onPay("PASS_30D", t("products.pass30d.name"), month.pricePengu)}
          size="lg"
          variant="outline"
          className="gap-2 font-bold"
        >
          <Calendar className="size-5" />
          {t("products.pass30d.name")} — {month.pricePengu} PENGU
          <Badge className="ms-1 bg-buy/15 text-buy hover:bg-buy/15" variant="secondary">
            −{month.discountPct}%
          </Badge>
        </Button>
      </div>
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

function FullSignalCard({ signal, locale }: { signal: FullSignal; locale: string }) {
  const { t } = useI18n();
  const actionColor =
    signal.action === "BUY" ? "text-buy" : signal.action === "SELL" ? "text-sell" : "text-hold";
  const actionBg =
    signal.action === "BUY" ? "bg-buy" : signal.action === "SELL" ? "bg-sell" : "bg-hold";
  const ActionIcon =
    signal.action === "BUY" ? ArrowUpToLine : signal.action === "SELL" ? ArrowDownToLine : PauseCircle;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* left: verdict */}
        <div className="glass-card relative overflow-hidden p-6">
          <div className={cn("absolute inset-x-0 top-0 h-1", actionBg)} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground">{t("signal.action")}</div>
              <div className={cn("mt-1 flex items-center gap-2.5 text-4xl font-black tracking-tight", actionColor)}>
                <ActionIcon className="size-9" />
                {t(`signal.${signal.action}`)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-medium text-muted-foreground">{t("signal.compositeScore")}</div>
              <div className="font-mono text-3xl font-black" dir="ltr">
                {signal.score > 0 ? "+" : ""}
                {signal.score.toFixed(1)}
              </div>
            </div>
          </div>

          {/* confidence gauge */}
          <div className="mt-6">
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

          {/* levels grid */}
          <div className="mt-6 grid grid-cols-2 gap-2.5">
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
            <Level label={t("signal.support")} value={fmt.price(signal.support)} />
            <Level label={t("signal.resistance")} value={fmt.price(signal.resistance)} />
          </div>
        </div>

        {/* right: factors + reasoning */}
        <div className="glass-card p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Target className="size-4 text-primary" />
            {t("signal.factors")}
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
