"use client";

/**
 * EngineSection — transparent methodology showcase.
 * Lists the actual indicator families used by the engine with weights.
 *
 * @module components/pengu/EngineSection
 */
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge } from "@/components/ui/badge";
import { Brain, Database, ShieldCheck } from "lucide-react";

/** The five factor families (target plan §3) — weights sum to 100. */
const INDICATORS = [
  { icon: "📈", fa: "روند EMA (20/50)", en: "EMA trend (20/50)", weight: 30 },
  { icon: "🚀", fa: "مومنتوم (ROC + شیب، نرمال‌شده با ATR)", en: "Momentum (ROC + slope, ATR-norm)", weight: 25 },
  { icon: "🌊", fa: "MACD (12/26/9)", en: "MACD (12/26/9)", weight: 20 },
  { icon: "⚡", fa: "RSI (14) وایلدر", en: "RSI (14) Wilder", weight: 15 },
  { icon: "🔊", fa: "رژیم حجم معاملات", en: "Volume regime", weight: 10 },
] as const;

/** ATR powers risk levels + the volatility warning — not a scored factor. */
const CONTEXT = [
  { icon: "📏", fa: "ATR (14) — سطوح ریسک و هشدار نوسان", en: "ATR (14) — risk levels & volatility warning" },
  { icon: "🕐", fa: "چهار تایم‌فریم: 15m / 1h / 4h / 1d", en: "Four timeframes: 15m / 1h / 4h / 1d" },
] as const;

export function EngineSection() {
  const { t, locale } = useI18n();
  return (
    <section id="engine" className="scroll-mt-20 px-4 py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <h2 className="flex items-center gap-2.5 text-2xl font-black sm:text-3xl">
            <Brain className="size-7 text-primary" />
            {t("engine.title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("engine.subtitle")}</p>
        </header>

        {/* indicators grid */}
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          {t("engine.indicatorsTitle")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INDICATORS.map((ind) => (
            <div
              key={ind.en}
              className="glass-card group flex items-center gap-3 px-4 py-3.5 transition-transform hover:-translate-y-0.5"
            >
              <span className="text-xl">{ind.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-bold">{locale === "fa" ? ind.fa : ind.en}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" dir="ltr">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(ind.weight / 30) * 100}%` }} />
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-[10px] font-black">
                w{ind.weight}
              </Badge>
            </div>
          ))}
        </div>

        {/* context row — what else the engine watches */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {CONTEXT.map((c) => (
            <div key={c.en} className="glass-card flex items-center gap-3 px-4 py-3 opacity-80">
              <span className="text-lg">{c.icon}</span>
              <span className="text-xs font-semibold text-muted-foreground">
                {locale === "fa" ? c.fa : c.en}
              </span>
            </div>
          ))}
        </div>

        {/* three pillars */}
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <Pillar
            icon={<ShieldCheck className="size-6" />}
            title={t("engine.securityTitle")}
            body={t("engine.securityBody")}
          />
          <Pillar icon={<Database className="size-6" />} title={t("engine.dataTitle")} body={t("engine.dataBody")} />
          <Pillar icon={<Brain className="size-6" />} title={t("engine.methodology")} body={t("engine.methodologyBody")} />
        </div>
      </div>
    </section>
  );
}

function Pillar({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="glass-card p-5">
      <span className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
        {icon}
      </span>
      <h4 className="mt-3 text-base font-extrabold">{title}</h4>
      <p className="mt-2 text-[13px] leading-7 text-muted-foreground">{body}</p>
    </div>
  );
}
