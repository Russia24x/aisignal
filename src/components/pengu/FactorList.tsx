"use client";

/**
 * FactorList — the engine's per-indicator breakdown, shared by the live
 * signal card (SignalSection) and the historical drill-down dialog
 * (SignalDetailDialog).
 *
 * Each row: localized indicator label + education tooltip (what this
 * indicator measures) + signed score bar (centre-zero, buy/sell colors)
 * + mono score. Sorted by |contribution| so the loudest driver is first.
 *
 * @module components/pengu/FactorList
 */
import { useI18n } from "@/components/i18n/I18nProvider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Factor {
  key: string;
  score: number;
  weight: number;
  contribution: number;
}

export const FACTOR_LABELS: Record<string, { fa: string; en: string }> = {
  emaTrend: { fa: "روند EMA (9/21)", en: "EMA trend (9/21)" },
  smaStructure: { fa: "ساختار SMA (20/50)", en: "SMA structure (20/50)" },
  rsi: { fa: "RSI (14)", en: "RSI (14)" },
  macd: { fa: "MACD (12/26/9)", en: "MACD (12/26/9)" },
  bollinger: { fa: "باندهای بولینگر", en: "Bollinger Bands" },
  stochastic: { fa: "استوکاستیک (14/3)", en: "Stochastic (14/3)" },
  obv: { fa: "جریان حجم (OBV)", en: "Volume flow (OBV)" },
  vwap: { fa: "VWAP", en: "VWAP" },
  momentum: { fa: "مومنتوم و شیب", en: "Momentum & slope" },
  volume: { fa: "رژیم حجم", en: "Volume regime" },
  srLevels: { fa: "حمایت/مقاومت", en: "Support/Resistance" },
};

export function FactorList({ factors, className }: { factors: Factor[]; className?: string }) {
  const { t, locale } = useI18n();
  const lang = locale === "fa" ? "fa" : "en";

  return (
    <div className={cn("space-y-2", className)}>
      {factors
        .slice()
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .map((f) => {
          const label = FACTOR_LABELS[f.key]?.[lang] ?? f.key;
          const hint = t(`signal.factorHint.${f.key}`);
          const pct = Math.min(100, Math.abs(f.score) * 100);
          const pos = f.score >= 0;
          return (
            <Tooltip key={f.key}>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 transition-colors hover:border-primary/30 hover:bg-muted/35">
                  <span className="flex w-28 shrink-0 items-center gap-1 text-xs font-semibold sm:w-36">
                    <span className="truncate">{label}</span>
                    <Info className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
                  </span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted" dir="ltr">
                    <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
                    <div
                      className={cn("absolute top-0 h-full", pos ? "bg-buy" : "bg-sell")}
                      style={pos ? { left: "50%", width: `${pct / 2}%` } : { right: "50%", width: `${pct / 2}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "w-14 shrink-0 text-left font-mono text-[11px] font-bold",
                      pos ? "text-buy" : "text-sell",
                    )}
                    dir="ltr"
                  >
                    {f.score >= 0 ? "+" : ""}
                    {f.score.toFixed(2)}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
                {hint !== `signal.factorHint.${f.key}` ? hint : null}
                <span className="mt-1 block text-muted-foreground">
                  {t("signal.weight")}: {f.weight} · contribution: {f.contribution >= 0 ? "+" : ""}
                  {f.contribution.toFixed(1)}
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
    </div>
  );
}
