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
  Loader2,
  PenLine,
  Sparkles,
  Ticket,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ACCESS_PASSES,
  perDayPrice,
  isLifetimePass,
  type AccessPassId,
} from "@/lib/modules/access/passes";

/**
 * Per-tier visual identity. Every pass keeps the glass-card base, but
 * premium tiers get their own aura so the upgrade ladder *reads* before
 * a single word is parsed:
 *   1d   → plain ice (entry point)
 *   7d   → primary ring + glow (the popular default)
 *   30d  → plain ice
 *   365d → gold "royal" theme (Crown)
 *   life → diamond theme with a slow travelling sheen (Gem)
 */
type TierTheme = "ice" | "popular" | "gold" | "diamond";

const TIER_META: Record<
  AccessPassId,
  { icon: LucideIcon; i18nKey: string; highlight: boolean; bestValue?: boolean; theme: TierTheme }
> = {
  PASS_1D: { icon: Zap, i18nKey: "pass1d", highlight: false, theme: "ice" },
  PASS_7D: { icon: Ticket, i18nKey: "pass7d", highlight: true, theme: "popular" },
  PASS_30D: { icon: Sparkles, i18nKey: "pass30d", highlight: false, theme: "ice" },
  PASS_365D: { icon: Crown, i18nKey: "pass365d", highlight: false, bestValue: true, theme: "gold" },
  PASS_LIFETIME: { icon: Gem, i18nKey: "passLifetime", highlight: false, theme: "diamond" },
};

/** Tailwind classes for the tier icon chip + price colour. */
const TIER_CHIP: Record<TierTheme, { chip: string; price: string }> = {
  ice: { chip: "bg-muted/40 text-ice ring-border", price: "text-primary" },
  popular: { chip: "bg-primary/20 text-primary ring-primary/40", price: "text-primary" },
  gold: {
    chip: "bg-hold/15 text-hold ring-hold/40",
    price: "text-hold",
  },
  diamond: {
    chip: "bg-accent/15 text-accent ring-accent/40",
    price: "text-accent",
  },
};

export function PricingSection() {
  const { t } = useI18n();
  const { entitlements, login, signIn, walletStatus, signingIn } = useAuth();
  const [product, setProduct] = useState<PaymentProduct | null>(null);

  const activeProduct = entitlements?.activeGrant?.product ?? null;
  const hasPass = !!entitlements?.signalAccess;
  const authenticated = !!entitlements?.authenticated;
  const connected = walletStatus === "connected";

  /**
   * PURCHASE-INTENT CONTINUATION — the second half of the "click a plan
   * does nothing" fix. When an anonymous visitor clicks a plan we start
   * the auth chain from that click; the plan they wanted is remembered
   * here and the moment the session lands (shared AuthProvider flips
   * `authenticated` for the WHOLE app) the payment dialog opens by itself.
   * Previously the click ended at a (possibly stale) "choose plan" button
   * that led straight into another sign-in prompt — from the user's view,
   * "the purchase never started".
   */
  const pendingProductRef = useRef<PaymentProduct | null>(null);
  useEffect(() => {
    if (authenticated && pendingProductRef.current) {
      setProduct(pendingProductRef.current);
      pendingProductRef.current = null;
    }
  }, [authenticated]);

  /**
   * Continue the auth chain from THIS click — the AGW connect/signature
   * popups are `window.open` calls that browsers only honour inside a user
   * gesture, so a click here is exactly the right trigger (same pattern as
   * SignalSection's ConnectGate). No dead disabled buttons for visitors.
   */
  const startAuth = (intended: PaymentProduct | null = null) => {
    if (intended) pendingProductRef.current = intended;
    if (connected) void signIn();
    else void login();
  };

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
            <Button
              className="mt-4 w-full gap-1.5 font-bold"
              variant="outline"
              disabled={authenticated || signingIn}
              onClick={() => startAuth()}
            >
              {signingIn ? (
                <Loader2 className="size-4 animate-spin" />
              ) : authenticated && !hasPass ? (
                <Check className="size-4" />
              ) : (
                <Wallet className="size-4" />
              )}
              {authenticated && !hasPass
                ? t("products.currentPlan")
                : signingIn
                  ? t("wallet.signing")
                  : t("products.free.cta")}
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
                  "group glass-card relative flex flex-col p-5 transition-all duration-300 hover:-translate-y-1",
                  meta.theme === "popular" && "tier-popular ring-2 ring-primary/50",
                  meta.theme === "gold" && "tier-gold",
                  meta.theme === "diamond" && "tier-diamond",
                )}
              >
                {/* travelling sheen layer (diamond tier only, CSS-animated) */}
                {meta.theme === "diamond" && <span aria-hidden className="diamond-sheen" />}
                {meta.bestValue && (
                  <Badge className="absolute -top-2.5 start-1/2 -translate-x-1/2 bg-hold px-3 font-black text-hold-foreground shadow-lg shadow-hold/20">
                    ★ {t("products.bestValue")}
                  </Badge>
                )}
                {meta.theme === "diamond" && (
                  <Badge
                    className="absolute -top-2.5 start-3 bg-accent/90 px-2 py-0.5 font-black text-accent-foreground shadow-lg shadow-accent/20"
                    aria-hidden
                  >
                    ✦
                  </Badge>
                )}
                <span
                  className={cn(
                    "grid size-11 place-items-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110",
                    TIER_CHIP[meta.theme].chip,
                  )}
                >
                  <Icon className="size-6" />
                </span>
                <h3 className="mt-3 text-base font-extrabold">{name}</h3>
                <p className="mt-1 flex-1 text-xs leading-6 text-muted-foreground">
                  {t(`products.${meta.i18nKey}.desc`)}
                </p>
                <div className="mt-4 flex flex-col gap-0.5" dir="ltr">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className={cn("font-mono text-3xl font-black", TIER_CHIP[meta.theme].price)}>
                      {pass.pricePengu.toLocaleString("en-US")}
                    </span>
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
                  disabled={!!owned || signingIn}
                  onClick={() => {
                    if (!authenticated) {
                      // remember the intent — the dialog auto-opens once the
                      // session lands (see pendingProductRef above)
                      startAuth({ id: pass.id, name, pricePengu: pass.pricePengu });
                      return;
                    }
                    setProduct({ id: pass.id, name, pricePengu: pass.pricePengu });
                  }}
                >
                  {owned ? (
                    <>
                      <Check className="size-4" />
                      {t("products.currentPlan")}
                    </>
                  ) : signingIn && !authenticated ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : !authenticated && connected ? (
                    // state-accurate affordance: the next step is the
                    // signature, not another wallet connection
                    <PenLine className="size-4" />
                  ) : (
                    !authenticated && <Wallet className="size-4" />
                  )}
                  {owned
                    ? t("products.currentPlan")
                    : signingIn && !authenticated
                      ? t("wallet.signing")
                      : !authenticated && connected
                        ? t("products.signInToBuy")
                        : t("products.choose")}
                </Button>
              </div>
            );
          })}
        </div>

        {!authenticated && (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            {/* state-accurate hint: connected users only need to sign in */}
            {connected ? t("signal.signInFirst") : t("signal.connectFirst")}
          </p>
        )}
      </div>

      <PaymentDialog
        key={product?.id ?? "none"}
        product={product}
        onClose={() => {
          setProduct(null);
          pendingProductRef.current = null;
        }}
      />
    </section>
  );
}
