"use client";

/**
 * PriceAlerts — authenticated users can create price-crossing alerts for
 * PENGU. The server's market service evaluates them on every snapshot
 * refresh (TTL-bounded) and marks triggered ones.
 *
 * UI:
 *  - create form: direction (ABOVE/BELOW) + target price (USD)
 *    + quick-set chips (+5% / -5% / +10% / -10% relative to live price)
 *  - live alerts list: active + recently-triggered, delete buttons
 *  - state shows live PENGU price as reference
 *
 * @module components/pengu/PriceAlerts
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Loader2, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { useMarket, fmt } from "./useMarket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AlertItem {
  id: string;
  direction: "ABOVE" | "BELOW";
  target: number;
  active: boolean;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  createdAt: string;
}

export function PriceAlerts() {
  const { t, locale } = useI18n();
  const { entitlements } = useAuth();
  const { data: market } = useMarket();
  const qc = useQueryClient();
  const [direction, setDirection] = useState<"ABOVE" | "BELOW">("ABOVE");
  const [targetStr, setTargetStr] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);

  const livePrice = market?.snapshot.priceUsd;

  const alertsQuery = useQuery({
    queryKey: ["alerts"],
    queryFn: async (): Promise<AlertItem[]> => {
      const r = await fetch("/api/alerts", { cache: "no-store" });
      const d = await r.json();
      return d.ok ? (d.alerts as AlertItem[]) : [];
    },
    enabled: !!entitlements?.authenticated,
    staleTime: 30_000,
    retry: 1,
  });

  const alerts = alertsQuery.data ?? [];
  const activeCount = alerts.filter((a) => a.active).length;
  const triggeredCount = alerts.length - activeCount;

  const createMut = useMutation({
    mutationFn: async (input: { direction: "ABOVE" | "BELOW"; target: number }) => {
      const r = await fetch("/api/alerts/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? "FAILED");
      return d;
    },
    onSuccess: () => {
      setTargetStr("");
      setFormErr(null);
      qc.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (err: Error) => {
      const code = err.message;
      setFormErr(code === "ALERT_LIMIT_REACHED" ? "maxReached" : code === "INVALID_INPUT" ? "invalidInput" : "common.error");
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/alerts/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? "FAILED");
      return d;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const submit = () => {
    setFormErr(null);
    const target = Number(targetStr);
    if (!Number.isFinite(target) || target <= 0) {
      setFormErr("invalidInput");
      return;
    }
    createMut.mutate({ direction, target });
  };

  const quickSet = (pct: number) => {
    if (!livePrice || livePrice <= 0) return;
    const next = direction === "ABOVE" ? livePrice * (1 + pct / 100) : livePrice * (1 - pct / 100);
    setTargetStr(next.toFixed(5));
    setFormErr(null);
  };

  const localeStr = locale === "fa" ? "fa-IR" : "en-US";

  // Not authenticated → show the connect gate
  if (!entitlements?.authenticated) {
    return (
      <section id="alerts" className="scroll-mt-20 px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <header className="mb-6">
            <h2 className="flex items-center gap-2.5 text-2xl font-black sm:text-3xl">
              <Bell className="size-7 text-primary" />
              {t("alerts.title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("alerts.subtitle")}</p>
          </header>
          <div className="glass-card flex flex-col items-center gap-4 px-6 py-12 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary ring-2 ring-primary/30">
              <BellOff className="size-7" />
            </span>
            <p className="max-w-md text-sm font-bold">{t("alerts.connectFirst")}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="alerts" className="scroll-mt-20 px-4 py-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2.5 text-2xl font-black sm:text-3xl">
              <Bell className="size-7 text-primary" />
              {t("alerts.title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("alerts.subtitle")}</p>
          </div>
          {livePrice && (
            <Badge variant="outline" className="gap-1.5 px-3 py-1.5 font-mono text-xs" dir="ltr">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              {t("alerts.livePrice")}: {fmt.price(livePrice)}
            </Badge>
          )}
        </header>

        {/* create form */}
        <div className="glass-card mb-5 p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
            {/* direction */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("alerts.direction")}
              </label>
              <div className="mt-1.5 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={direction === "ABOVE" ? "default" : "outline"}
                  onClick={() => setDirection("ABOVE")}
                  className="flex-1 gap-1.5 font-bold"
                >
                  <TrendingUp className="size-4" />
                  {t("alerts.above")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={direction === "BELOW" ? "default" : "outline"}
                  onClick={() => setDirection("BELOW")}
                  className="flex-1 gap-1.5 font-bold"
                >
                  <TrendingDown className="size-4" />
                  {t("alerts.below")}
                </Button>
              </div>
            </div>
            {/* target input */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("alerts.target")}
              </label>
              <Input
                dir="ltr"
                type="number"
                inputMode="decimal"
                step="0.00001"
                min="0"
                placeholder="0.00000"
                value={targetStr}
                onChange={(e) => setTargetStr(e.target.value)}
                className="mt-1.5 font-mono"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
            {/* submit */}
            <div className="flex items-end">
              <Button
                onClick={submit}
                disabled={createMut.isPending || !targetStr}
                size="lg"
                className="w-full gap-1.5 font-bold sm:w-auto"
              >
                {createMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {createMut.isPending ? t("alerts.creating") : t("alerts.create")}
              </Button>
            </div>
          </div>

          {/* quick-set chips */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">{t("alerts.examples")}</span>
            {[
              { pct: 5, sign: "above", key: "ex_above5" },
              { pct: 10, sign: "above", key: "ex_above10" },
              { pct: 5, sign: "below", key: "ex_below5" },
              { pct: 10, sign: "below", key: "ex_below10" },
            ].map((chip) => {
              const chipDir = chip.sign === "above" ? "ABOVE" : "BELOW";
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => {
                    setDirection(chipDir);
                    setTimeout(() => {
                      const p = market?.snapshot.priceUsd;
                      if (!p || p <= 0) return;
                      const next = chipDir === "ABOVE" ? p * (1 + chip.pct / 100) : p * (1 - chip.pct / 100);
                      setTargetStr(next.toFixed(5));
                    }, 0);
                  }}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 font-mono font-bold transition-colors",
                    direction === chipDir
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`alerts.${chip.key}`)}
                </button>
              );
            })}
          </div>

          {/* form error */}
          {formErr && (
            <Alert variant="destructive" className="mt-3 py-2 text-xs">
              <AlertDescription>
                {formErr === "maxReached"
                  ? t("alerts.maxReached")
                  : formErr === "invalidInput"
                    ? t("alerts.invalidInput")
                    : t("common.error")}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* active count badge */}
        <div className="mb-3 flex items-center justify-between text-xs">
          <Badge variant="outline" className="gap-1.5 px-2.5 py-1 font-bold">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-buy opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-buy" />
            </span>
            {t("alerts.activeCount", { n: String(activeCount) })}
          </Badge>
          {triggeredCount > 0 && (
            <span className="text-muted-foreground">
              {triggeredCount} {t("alerts.triggered").toLowerCase()}
            </span>
          )}
        </div>

        {/* alerts list */}
        {alertsQuery.isLoading ? (
          <div className="glass-card p-5 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : alerts.length === 0 ? (
          <div className="empty-grid glass-card relative px-6 py-12 text-center">
            <div className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-primary/15 text-primary ring-2 ring-primary/30">
              <BellOff className="size-5" />
            </div>
            <p className="text-sm font-bold">🔔 {t("alerts.noAlerts")}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {alerts.map((a) => (
              <AlertRow
                key={a.id}
                alert={a}
                livePrice={livePrice}
                onDelete={() => deleteMut.mutate(a.id)}
                deleting={deleteMut.isPending && deleteMut.variables === a.id}
                localeStr={localeStr}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AlertRow({
  alert,
  livePrice,
  onDelete,
  deleting,
  localeStr,
  t,
}: {
  alert: AlertItem;
  livePrice?: number;
  onDelete: () => void;
  deleting: boolean;
  localeStr: string;
  t: (k: string, params?: Record<string, string | number>) => string;
}) {
  const isAbove = alert.direction === "ABOVE";
  const Icon = isAbove ? TrendingUp : TrendingDown;
  const iconColor = isAbove ? "text-buy" : "text-sell";

  // distance from current price
  const distPct =
    livePrice && livePrice > 0
      ? ((alert.target - livePrice) / livePrice) * 100
      : null;

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          "glass-card flex items-center gap-3 px-4 py-3",
          !alert.active && "opacity-70",
        )}
      >
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl ring-1",
            alert.active
              ? "bg-primary/15 ring-primary/30"
              : "bg-muted ring-border",
            alert.active ? iconColor : "text-muted-foreground",
          )}
        >
          <Icon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold">
              {isAbove ? t("alerts.above") : t("alerts.below")}
            </span>
            <span className="font-mono text-base font-black" dir="ltr">
              ${alert.target.toFixed(5)}
            </span>
            {alert.active ? (
              <Badge className="gap-1 bg-buy/15 px-1.5 py-0 text-[10px] font-black text-buy ring-1 ring-buy/30">
                ● {t("alerts.active")}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-black text-muted-foreground">
                ✓ {t("alerts.triggered")}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            {alert.active && distPct !== null ? (
              <span dir="ltr">
                {distPct >= 0 ? "+" : ""}
                {distPct.toFixed(2)}% {t("alerts.livePrice").toLowerCase()}
              </span>
            ) : alert.triggeredAt ? (
              <span>
                {t("alerts.firedAt")}:{" "}
                <span className="font-mono" dir="ltr">
                  {alert.triggeredPrice ? `$${alert.triggeredPrice.toFixed(5)}` : "—"}
                </span>{" "}
                ·{" "}
                {new Date(alert.triggeredAt).toLocaleString(localeStr, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            ) : null}
            <span>·</span>
            <span>
              {new Date(alert.createdAt).toLocaleDateString(localeStr, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={deleting}
              className="size-9 text-muted-foreground hover:text-destructive"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {t("alerts.delete")}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
