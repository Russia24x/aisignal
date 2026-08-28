"use client";

/**
 * PricingSection — the tariff cards (platform access, day pass, subscriptions).
 *
 * @module components/pengu/PricingSection
 */
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { PaymentDialog, type PaymentProduct } from "./PaymentDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Coins, Crown, Sparkles, Ticket } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function PricingSection() {
  const { t } = useI18n();
  const { entitlements } = useAuth();
  const [product, setProduct] = useState<PaymentProduct | null>(null);

  const plans = [
    {
      id: "PLATFORM_ACCESS",
      icon: <Coins className="size-6" />,
      name: t("products.platform.name"),
      desc: t("products.platform.desc"),
      price: "5",
      highlight: false,
    },
    {
      id: "DAY_PASS",
      icon: <Ticket className="size-6" />,
      name: t("products.dayPass.name"),
      desc: t("products.dayPass.desc"),
      price: "1",
      highlight: true,
    },
    {
      id: "SUB_7",
      icon: <Sparkles className="size-6" />,
      name: t("products.sub7.name"),
      desc: t("products.sub7.desc"),
      price: "7",
      highlight: false,
    },
    {
      id: "SUB_30",
      icon: <Crown className="size-6" />,
      name: t("products.sub30.name"),
      desc: t("products.sub30.desc"),
      price: "30",
      highlight: false,
      bestValue: true,
    },
  ];

  return (
    <section id="pricing" className="scroll-mt-20 px-4 py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 text-center">
          <h2 className="text-2xl font-black sm:text-3xl">{t("products.choose")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("brand.tagline")}</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const owned =
              (p.id === "PLATFORM_ACCESS" && entitlements?.platformAccess) ||
              (p.id !== "PLATFORM_ACCESS" && entitlements?.signalAccess);
            return (
              <div
                key={p.id}
                className={cn(
                  "glass-card relative flex flex-col p-5 transition-transform hover:-translate-y-1",
                  p.highlight && "ring-2 ring-primary/50",
                )}
              >
                {p.bestValue && (
                  <Badge className="absolute -top-2.5 start-1/2 -translate-x-1/2 bg-primary px-3 font-black text-primary-foreground">
                    ★
                  </Badge>
                )}
                <span
                  className={cn(
                    "grid size-11 place-items-center rounded-xl ring-1",
                    p.highlight ? "bg-primary/20 text-primary ring-primary/40" : "bg-muted/40 text-ice ring-border",
                  )}
                >
                  {p.icon}
                </span>
                <h3 className="mt-3 text-base font-extrabold">{p.name}</h3>
                <p className="mt-1 flex-1 text-xs leading-6 text-muted-foreground">{p.desc}</p>
                <div className="mt-4 flex items-baseline gap-1.5" dir="ltr">
                  <span className="font-mono text-3xl font-black text-primary">{p.price}</span>
                  <span className="text-xs font-bold text-muted-foreground">PENGU</span>
                </div>
                <Button
                  className="mt-4 w-full gap-1.5 font-bold"
                  variant={p.highlight ? "default" : "outline"}
                  disabled={!entitlements?.authenticated || !!owned}
                  onClick={() => setProduct({ id: p.id, name: p.name, pricePengu: Number(p.price) })}
                >
                  {owned ? (
                    <>
                      <Check className="size-4" />
                      ✓
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
