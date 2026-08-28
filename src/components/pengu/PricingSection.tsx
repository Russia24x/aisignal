"use client";

/**
 * PricingSection — the tariff grid (free tier + access passes).
 *
 * All prices come from lib/modules/access/passes.ts — the single source of
 * truth shared with the server's payment verification. Nothing is hardcoded
 * here, so changing the tariff is a one-file edit.
 *
 * @module components/pengu/PricingSection
 */
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { PaymentDialog, type PaymentProduct } from "./PaymentDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Crown,
  Eye,
  Gem,
  Sparkles,
  Ticket,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ACCESS_PASSES,
  perDayPrice,
  isLifetimePass,
  type AccessPassId,
} from "@/lib/modules/access/passes";

const TIER_META: Record<AccessPassId, { icon: LucideIcon; i18nKey: string; highlight: boolean; bestValue?: boolean }> = {
  PASS_1D: { icon: Zap, i18nKey: "pass1d", highlight: false },
  PASS_7D: { icon: Ticket, i18nKey: "pass7d", highlight: true },
  PASS_30D: { icon: Sparkles, i18nKey: "pass30d", highlight: false },
  PASS_365D: { icon: Crown, i18nKey: "pass365d", highlight: false, bestValue: true },
  PASS_LIFETIME: { icon: Gem, i18nKey: "passLifetime", highlight: false },
};

export function PricingSection() {
  const { t } = useI18n();
  const { entitlements } = useAuth();
  const [product, setProduct] = useState<PaymentProduct | null>(null);

  const activeProduct = entitlements?.activeGrant?.product ?? null;
  const hasPass = !!entitlements?.signalAccess;

  return (
    <section id="pricing" className="scroll-mt-20 px-4 py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 text-center">
          <h2 className="text-2xl font-black sm:text-3xl">{t("products.choose")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("products.freeTierNote")}</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* free tier card */}
          <div className="glass-card relative flex flex-col p-5">
            <span className="grid size-11 place-items-center rounded-xl bg-muted/40 text-ice ring-1 ring-border">
              <Eye className="size-6" />
            </span>
            <h3 className="mt-3 text-base font-extrabold">{t("products.free.name")}</h3>
            <p className="mt-1 flex-1 text-xs leading-6 text-muted-foreground">{t("products.free.desc")}</p>
            <div className="mt-4 flex items-baseline gap-1.5" dir="ltr">
              <span className="font-mono text-3xl font-black text-primary">0</span>
              <span className="text-xs font-bold text-muted-foreground">PENGU</span>
            </div>
            <Button className="mt-4 w-full gap-1.5 font-bold" variant="outline" disabled>
              {entitlements?.authenticated && !hasPass ? (
                <>
                  <Check className="size-4" />
                  {t("products.currentPlan")}
                </>
              ) : (
                t("products.free.cta")
              )}
            </Button>
          </div>

          {/* paid pass cards — driven by the shared catalog */}
          {ACCESS_PASSES.map((pass) => {
            const meta = TIER_META[pass.id];
            const Icon = meta.icon;
            const perDay = perDayPrice(pass);
            const owned = activeProduct === pass.id;
            const name = t(`products.${meta.i18nKey}.name`);
            return (
              <div
                key={pass.id}
                className={cn(
                  "glass-card relative flex flex-col p-5 transition-transform hover:-translate-y-1",
                  meta.highlight && "ring-2 ring-primary/50",
                )}
              >
                {meta.bestValue && (
                  <Badge className="absolute -top-2.5 start-1/2 -translate-x-1/2 bg-primary px-3 font-black text-primary-foreground">
                    ★
                  </Badge>
                )}
                <span
                  className={cn(
                    "grid size-11 place-items-center rounded-xl ring-1",
                    meta.highlight ? "bg-primary/20 text-primary ring-primary/40" : "bg-muted/40 text-ice ring-border",
                  )}
                >
                  <Icon className="size-6" />
                </span>
                <h3 className="mt-3 text-base font-extrabold">{name}</h3>
                <p className="mt-1 flex-1 text-xs leading-6 text-muted-foreground">
                  {t(`products.${meta.i18nKey}.desc`)}
                </p>
                <div className="mt-4 flex flex-col gap-0.5" dir="ltr">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-3xl font-black text-primary">{pass.pricePengu}</span>
                    <span className="text-xs font-bold text-muted-foreground">PENGU</span>
                  </div>
                  {perDay !== null && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      ≈ {perDay.toFixed(2)} PENGU/{t("products.dayUnit")}
                    </span>
                  )}
                  {isLifetimePass(pass.id) && (
                    <span className="text-[11px] font-bold text-primary">∞ {t("products.noExpiry")}</span>
                  )}
                </div>
                <Button
                  className="mt-4 w-full gap-1.5 font-bold"
                  variant={meta.highlight ? "default" : "outline"}
                  disabled={!entitlements?.authenticated || !!owned}
                  onClick={() => setProduct({ id: pass.id, name, pricePengu: pass.pricePengu })}
                >
                  {owned ? (
                    <>
                      <Check className="size-4" />
                      {t("products.currentPlan")}
                    </>
                  ) : (
                    t("products.choose")
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        {!entitlements?.authenticated && (
          <p className="mt-5 text-center text-xs text-muted-foreground">{t("signal.connectFirst")}</p>
        )}
      </div>

      <PaymentDialog key={product?.id ?? "none"} product={product} onClose={() => setProduct(null)} />
    </section>
  );
}
