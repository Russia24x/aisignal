"use client";

/**
 * MyDashboard — per-user dashboard section.
 *
 * Visible ONLY to authenticated users who hold platform access
 * (paid the one-time 5 PENGU tariff). Renders `null` for everyone else,
 * so the section is invisible for visitors and connected-but-not-paid
 * users — the page flow remains unchanged for them.
 *
 * Sits between the Signal section and the Pricing section. Shows:
 *   1. Subscription status (active / expired + days-left progress bar)
 *   2. Platform access (since when, "lifetime" label)
 *   3. Total spent in PENGU (large mono number)
 *   4. Recent payments (last 5, scrollable, links to explorer)
 *
 * Data source: GET /api/me/dashboard (auth + platform-access gated).
 *
 * @module components/pengu/MyDashboard
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n, type Locale } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { useAbstractProfile } from "@/hooks/useAbstractProfile";
import { getTierColor } from "@/lib/abstract/profile";
import { AbstractProfile } from "@/components/abstract/AbstractProfile";
import { publicConfig } from "@/lib/public-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CalendarClock,
  CheckCircle2,
  Coins,
  ExternalLink,
  History,
  Loader2,
  Medal,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* --------------------------- types --------------------------- */

interface DashboardEntitlements {
  authenticated: boolean;
  address: string | null;
  platformAccess: boolean;
  signalAccess: boolean;
  activeGrant: { product: "DAY_PASS" | "SUBSCRIPTION"; expiresAt: string } | null;
  subscriptionDaysLeft: number;
}

interface DashboardActiveGrant {
  product: "DAY_PASS" | "SUBSCRIPTION";
  startsAt: string;
  expiresAt: string;
  daysLeft: number;
  totalDays: number;
  progressPercent: number;
}

interface DashboardPayment {
  txHash: string;
  product: string;
  amountToken: number;
  status: string;
  verifiedAt: string;
}

interface DashboardData {
  entitlements: DashboardEntitlements;
  activeGrant: DashboardActiveGrant | null;
  payments: DashboardPayment[];
  platformAccessAt: string | null;
  daysLeft: number;
  totalSpentPengu: number;
}

/* --------------------------- helpers --------------------------- */

const PRODUCT_LABEL_KEY: Record<string, string> = {
  PLATFORM_ACCESS: "products.platform.name",
  DAY_PASS: "products.dayPass.name",
  SUB_7: "products.sub7.name",
  SUB_30: "products.sub30.name",
};

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function shortTx(h: string): string {
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function productLabel(t: (k: string) => string, product: string): string {
  return t(PRODUCT_LABEL_KEY[product] ?? "products.platform.name");
}

function grantProductLabel(
  t: (k: string) => string,
  product: "DAY_PASS" | "SUBSCRIPTION",
): string {
  return product === "DAY_PASS" ? t("products.dayPass.name") : t("dashboard.subscription");
}

function formatDate(iso: string, locale: Locale): string {
  const localeTag = locale === "fa" ? "fa-IR" : "en-US";
  return new Date(iso).toLocaleDateString(localeTag, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string, locale: Locale): string {
  const localeTag = locale === "fa" ? "fa-IR" : "en-US";
  return new Date(iso).toLocaleString(localeTag, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(iso: string, locale: Locale): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
    numeric: "auto",
  });
  if (diffSec < 60) return rtf.format(-diffSec, "second");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return rtf.format(-diffHr, "hour");
  const diffDay = Math.floor(diffHr / 24);
  return rtf.format(-diffDay, "day");
}

function formatPengu(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/* --------------------------- main --------------------------- */

export function MyDashboard() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { entitlements, loading: authLoading } = useAuth();

  const enabled = !!entitlements?.authenticated && !!entitlements?.platformAccess;

  const query = useQuery<DashboardData>({
    queryKey: ["me-dashboard", entitlements?.address],
    queryFn: async (): Promise<DashboardData> => {
      const res = await fetch("/api/me/dashboard", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "ERROR");
      return data.dashboard as DashboardData;
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
  });

  const profileQuery = useAbstractProfile();
  const portalProfile = profileQuery.data ?? null;

  // hard gate: render nothing for visitors / connected-but-not-paid users
  if (!enabled || authLoading) return null;

  const dashboard = query.data ?? null;
  const address = entitlements?.address ?? null;
  const loading = query.isLoading || query.isPending;

  return (
    <section id="dashboard" className="scroll-mt-20 px-4 py-12">
      <div className="mx-auto max-w-6xl">
        {/* sticky section header */}
        <header className="sticky top-16 z-30 -mx-4 mb-6 flex items-center justify-between gap-3 border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black sm:text-lg">{t("dashboard.title")}</h2>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {t("dashboard.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {address && (
              <TooltipProvider delayDuration={250}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="gap-1.5 font-mono text-xs">
                      <Wallet className="size-3" />
                      <span dir="ltr">{shortAddr(address)}</span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="font-mono text-xs">
                    <span dir="ltr">{address}</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: ["me-dashboard"] })
              }
              disabled={query.isFetching}
              aria-label={t("dashboard.refresh")}
            >
              {query.isFetching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              <span className="hidden sm:inline">{t("dashboard.refresh")}</span>
            </Button>
          </div>
        </header>

        {/* Abstract Portal identity banner */}
        <PortalIdentity
          address={address as `0x${string}` | null}
          profile={portalProfile}
          loading={profileQuery.isLoading}
          t={t}
        />

        {/* 4-card grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SubscriptionCard
            dashboard={dashboard}
            loading={loading}
            t={t}
            locale={locale}
          />
          <PlatformAccessCard
            dashboard={dashboard}
            loading={loading}
            t={t}
            locale={locale}
          />
          <TotalSpentCard dashboard={dashboard} loading={loading} t={t} />
          <RecentPaymentsCard
            dashboard={dashboard}
            loading={loading}
            t={t}
            locale={locale}
          />
        </div>
      </div>
    </section>
  );
}

/* --------------------------- cards --------------------------- */

type TFunc = (key: string) => string;

/**
 * Abstract Portal identity banner — avatar with tier ring, display name,
 * tier badge, badge count and a deep-link to the public Portal profile.
 * Gracefully degrades when the wallet has no Portal profile yet.
 */
function PortalIdentity({
  address,
  profile,
  loading,
  t,
}: {
  address: `0x${string}` | null;
  profile: import("@/lib/abstract/profile").AbstractProfileData | null;
  loading: boolean;
  t: TFunc;
}) {
  if (!address) return null;

  const tierNameKey = `dashboard.tier.${profile?.tier ?? 1}`;
  const tierName = t(tierNameKey) !== tierNameKey ? t(tierNameKey) : t("dashboard.tier.1");
  const tierColor = getTierColor(profile?.tier ?? 1);
  const displayName =
    profile?.name || `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <div className="glass-card mb-4 flex flex-wrap items-center gap-4 p-4 sm:gap-5">
      <AbstractProfile address={address} size="lg" showTooltip={false} />

      <div className="min-w-0 flex-1">
        {loading ? (
          <Skeleton className="mb-1.5 h-5 w-32" />
        ) : (
          <p className="truncate text-sm font-black sm:text-base">{displayName}</p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("dashboard.portalIdentity")}</span>
          {profile ? (
            <Badge
              variant="outline"
              className="gap-1 border-transparent px-1.5 font-bold"
              style={{ color: tierColor, background: `${tierColor}1a` }}
            >
              <Medal className="size-3" />
              {tierName}
            </Badge>
          ) : loading ? null : (
            <span className="opacity-70">{t("dashboard.noPortalProfile")}</span>
          )}
        </p>
      </div>

      {profile && profile.badges.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-1.5" dir="ltr">
            {profile.badges.slice(0, 5).map((b) => (
              <Tooltip key={b.id}>
                <TooltipTrigger asChild>
                  <span
                    className="grid size-8 place-items-center overflow-hidden rounded-full bg-muted/60 ring-1 ring-border/60 transition-transform hover:scale-110"
                    role="img"
                    aria-label={b.name}
                  >
                    {b.icon ? (
                      <img src={b.icon} alt={b.name} className="size-full object-cover" loading="lazy" />
                    ) : (
                      <Medal className="size-3.5 text-muted-foreground" />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <p className="font-medium">{b.name}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            {profile.badgeCount > profile.badges.length && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                +{profile.badgeCount - profile.badges.length}
              </Badge>
            )}
          </div>
        </TooltipProvider>
      )}

      <Button
        asChild
        size="sm"
        variant="ghost"
        className="gap-1.5 text-muted-foreground"
      >
        <a
          href={`https://abs.xyz/profile/${address}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="size-3.5" />
          <span className="hidden sm:inline">{t("dashboard.viewOnPortal")}</span>
        </a>
      </Button>
    </div>
  );
}

function CardShell({
  icon,
  title,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass-card flex flex-col p-4", className)}>
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/25">
          {icon}
        </span>
        <h3 className="text-xs font-bold text-muted-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function SubscriptionCard({
  dashboard,
  loading,
  t,
  locale,
}: {
  dashboard: DashboardData | null;
  loading: boolean;
  t: TFunc;
  locale: Locale;
}) {
  const grant = dashboard?.activeGrant ?? null;
  const active = !!grant;

  return (
    <CardShell icon={<CalendarClock className="size-4" />} title={t("dashboard.subscription")}>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-2.5 w-full" />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant="outline"
              className={cn(
                "gap-1 px-2 py-0.5 font-black",
                active
                  ? "bg-buy/15 text-buy ring-1 ring-buy/30"
                  : "bg-muted text-muted-foreground ring-1 ring-border",
              )}
            >
              {active ? <CheckCircle2 className="size-3" /> : <CalendarClock className="size-3" />}
              {active ? t("dashboard.active") : t("dashboard.expired")}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {grant ? grantProductLabel(t, grant.product) : t("dashboard.notAvailable")}
            </span>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            {t("dashboard.expiresAt")}
            <div className="mt-0.5 font-mono text-sm font-bold" dir="ltr">
              {grant ? formatDate(grant.expiresAt, locale) : t("dashboard.notAvailable")}
            </div>
          </div>

          {active && grant && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{t("dashboard.daysLeft")}</span>
                <span className="font-mono font-bold" dir="ltr">
                  {grant.daysLeft}/{grant.totalDays}
                </span>
              </div>
              <Progress value={grant.progressPercent} className="h-2.5" />
            </div>
          )}
        </>
      )}
    </CardShell>
  );
}

function PlatformAccessCard({
  dashboard,
  loading,
  t,
  locale,
}: {
  dashboard: DashboardData | null;
  loading: boolean;
  t: TFunc;
  locale: Locale;
}) {
  const since = dashboard?.platformAccessAt ?? null;

  return (
    <CardShell icon={<CheckCircle2 className="size-4" />} title={t("dashboard.platformAccess")}>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-full bg-buy/15 text-buy ring-1 ring-buy/30">
              <CheckCircle2 className="size-5" />
            </span>
            <Badge className="bg-buy/15 px-2 py-0.5 font-black text-buy ring-1 ring-buy/30">
              {t("dashboard.lifetime")}
            </Badge>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            {t("dashboard.since")}
            <div className="mt-0.5 font-mono text-sm font-bold" dir="ltr">
              {since ? formatDate(since, locale) : t("dashboard.notAvailable")}
            </div>
          </div>
        </>
      )}
    </CardShell>
  );
}

function TotalSpentCard({
  dashboard,
  loading,
  t,
}: {
  dashboard: DashboardData | null;
  loading: boolean;
  t: TFunc;
}) {
  const total = dashboard?.totalSpentPengu ?? 0;

  return (
    <CardShell icon={<Coins className="size-4" />} title={t("dashboard.totalSpent")}>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5" dir="ltr">
            <span className="font-mono text-3xl font-black text-primary">
              {formatPengu(total)}
            </span>
            <span className="text-xs font-bold text-muted-foreground">PENGU</span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("dashboard.recentPayments")}: {dashboard?.payments.length ?? 0}/5
          </p>
        </>
      )}
    </CardShell>
  );
}

function RecentPaymentsCard({
  dashboard,
  loading,
  t,
  locale,
}: {
  dashboard: DashboardData | null;
  loading: boolean;
  t: TFunc;
  locale: Locale;
}) {
  const payments = dashboard?.payments ?? [];

  return (
    <CardShell
      icon={<History className="size-4" />}
      title={t("dashboard.recentPayments")}
      className="lg:col-span-1"
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : payments.length === 0 ? (
        <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1.5 py-4 text-center">
          <History className="size-6 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">{t("dashboard.noPayments")}</p>
        </div>
      ) : (
        <TooltipProvider delayDuration={200}>
          <ul className="max-h-40 space-y-2 overflow-y-auto pe-1 nice-scroll" dir="ltr">
            {payments.map((p) => (
              <li
                key={p.txHash}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm font-black text-primary">
                      {formatPengu(p.amountToken)}
                    </span>
                    <span className="text-[10px] font-bold text-muted-foreground">PENGU</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="px-1 py-0 text-[10px] font-bold"
                    >
                      {productLabel(t, p.product)}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={`${publicConfig.explorerUrl}/tx/${p.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                        >
                          {shortTx(p.txHash)}
                          <ExternalLink className="size-2.5" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="font-mono text-xs">
                        <span dir="ltr">{p.txHash}</span>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <time
                      className="shrink-0 cursor-default font-mono text-[10px] text-muted-foreground"
                      dateTime={p.verifiedAt}
                    >
                      {relativeTime(p.verifiedAt, locale)}
                    </time>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="font-mono text-xs">
                    <span dir="ltr">{formatDateTime(p.verifiedAt, locale)}</span>
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </TooltipProvider>
      )}
    </CardShell>
  );
}
