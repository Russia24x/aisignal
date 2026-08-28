"use client";

/**
 * AdminPanel — the owner console (admin-only dashboard section).
 *
 * Renders ONLY for wallets listed in ADMIN_ADDRESSES (server-driven via the
 * session entitlements `admin` flag). For everyone else it returns null —
 * zero DOM footprint, zero admin API calls.
 *
 * Three tabs, mirroring the three admin APIs:
 *   1. Overview  — KPI cards: users, active passes, revenue, win rate, …
 *   2. Users     — paginated wallet directory with pass status + lifetime spend
 *   3. Payments  — paginated verified-payment log with explorer links
 *
 * Design notes: follows the site's glass-card + sticky-section-header
 * pattern (same as MyDashboard) but with an amber/rose owner accent so it
 * reads as "ops", not "product". All numeric cells are mono LTR (RTL-safe);
 * addresses/tx hashes are short with copy + explorer link affordances.
 *
 * @module components/pengu/AdminPanel
 */
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n, type Locale } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { publicConfig } from "@/lib/public-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  BellRing,
  Check,
  Coins,
  Copy,
  Crown,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

/* --------------------------- types --------------------------- */

interface OverviewData {
  users: { total: number; new7d: number; activePass: number; logins7d: number };
  revenue: {
    totalPengu: number;
    paymentsCount: number;
    payments7d: number;
    lastPaymentAt: string | null;
  };
  signals: { total: number; open: number; wins: number; losses: number; winRate: number };
  alerts: { active: number; triggered: number };
  generatedAt: string;
}

interface AdminUser {
  address: string;
  createdAt: string;
  lastLoginAt: string;
  loginCount: number;
  activePass: { product: string; expiresAt: string; daysLeft: number; lifetime: boolean } | null;
  totalSpentPengu: number;
  paymentsCount: number;
}

interface AdminPayment {
  txHash: string;
  product: string;
  amountToken: number;
  fromAddress: string;
  toAddress: string;
  status: string;
  verifiedAt: string;
  blockNumber: string | null;
}

/* --------------------------- helpers --------------------------- */

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function shortTx(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

const PRODUCT_LABEL_KEY: Record<string, string> = {
  PASS_1D: "products.pass1d.name",
  PASS_7D: "products.pass7d.name",
  PASS_30D: "products.pass30d.name",
  PASS_365D: "products.pass365d.name",
  PASS_LIFETIME: "products.passLifetime.name",
  LEGACY_PLATFORM: "products.legacy.platform",
  PLATFORM_ACCESS: "products.legacy.platform",
  DAY_PASS: "products.legacy.dayPass",
  SUB_7: "products.legacy.sub7",
  SUB_30: "products.legacy.sub30",
};

function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === "fa" ? "fa-IR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPengu(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function explorerAddressUrl(address: string): string {
  return `${publicConfig.explorerUrl}/address/${address}`;
}

function explorerTxUrl(txHash: string): string {
  return `${publicConfig.explorerUrl}/tx/${txHash}`;
}

/* --------------------------- main --------------------------- */

export function AdminPanel() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { entitlements, loading: authLoading } = useAuth();

  // hard gate: only configured owners ever render this section
  const enabled = !!entitlements?.admin;
  if (!enabled || authLoading) return null;

  return (
    <section id="admin" className="scroll-mt-20 px-4 py-12">
      <div className="mx-auto max-w-6xl">
        {/* sticky section header — amber owner accent */}
        <header className="sticky top-16 z-30 -mx-4 mb-6 flex items-center justify-between gap-3 border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30 dark:text-amber-400">
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 truncate text-base font-black sm:text-lg">
                {t("admin.title")}
                <Badge
                  variant="outline"
                  className="gap-1 bg-amber-500/10 px-1.5 font-black text-amber-600 ring-amber-500/40 dark:text-amber-400"
                >
                  <Crown className="size-3" />
                  {t("admin.badge")}
                </Badge>
              </h2>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {t("admin.subtitle")}
              </p>
            </div>
          </div>
        </header>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="mb-4 h-auto w-full gap-1 rounded-xl bg-card/60 p-1 sm:w-auto">
            <TabsTrigger
              value="overview"
              className="gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
            >
              <Activity className="size-3.5" />
              {t("admin.tabOverview")}
            </TabsTrigger>
            <TabsTrigger
              value="users"
              className="gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
            >
              <Users className="size-3.5" />
              {t("admin.tabUsers")}
            </TabsTrigger>
            <TabsTrigger
              value="payments"
              className="gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
            >
              <Coins className="size-3.5" />
              {t("admin.tabPayments")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="payments">
            <PaymentsTab />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );

  /* ---------------- tab: overview ---------------- */

  function OverviewTab() {
    const query = useQuery<OverviewData>({
      queryKey: ["admin-overview"],
      queryFn: async (): Promise<OverviewData> => {
        const res = await fetch("/api/admin/overview", { cache: "no-store" });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "ERROR");
        return data.overview as OverviewData;
      },
      staleTime: 30_000,
      retry: 1,
    });

    if (query.isLoading) {
      return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      );
    }
    if (query.isError || !query.data) {
      return (
        <div className="glass-card grid place-items-center p-10 text-center">
          <ShieldCheck className="mb-2 size-8 text-muted-foreground/50" />
          <p className="text-sm font-bold text-muted-foreground">{t("admin.forbidden")}</p>
        </div>
      );
    }

    const o = query.data;
    return (
      <div className="space-y-4">
        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard icon={<Users className="size-4" />} label={t("admin.kpiUsers")} value={String(o.users.total)} sub={`+${o.users.new7d} · 7d`} accent="primary" />
          <KpiCard icon={<KeyRound className="size-4" />} label={t("admin.kpiActivePass")} value={String(o.users.activePass)} sub={`${t("admin.kpiNewUsers")}: ${o.users.new7d}`} accent="buy" />
          <KpiCard icon={<Coins className="size-4" />} label={t("admin.kpiRevenue")} value={formatPengu(o.revenue.totalPengu)} sub={`${o.revenue.paymentsCount} × PENGU`} accent="amber" />
          <KpiCard icon={<Target className="size-4" />} label={t("admin.kpiWinRate")} value={`${o.signals.winRate}%`} sub={`${o.signals.wins}W / ${o.signals.losses}L`} accent={o.signals.winRate >= 50 ? "buy" : "sell"} />
          <KpiCard icon={<Activity className="size-4" />} label={t("admin.kpiOpenSignals")} value={String(o.signals.open)} sub={`${o.signals.total} total`} accent="hold" />
          <KpiCard icon={<TrendingUp className="size-4" />} label={t("admin.kpiPayments7d")} value={String(o.revenue.payments7d)} sub={`${t("admin.kpiPayments")}: ${o.revenue.paymentsCount}`} accent="primary" />
          <KpiCard icon={<BellRing className="size-4" />} label={t("admin.kpiActiveAlerts")} value={String(o.alerts.active)} sub={`${o.alerts.triggered} ✓`} accent="hold" />
          <KpiCard icon={<UserRound className="size-4" />} label={t("admin.kpiLogins")} value={String(o.users.logins7d)} sub={t("admin.lastUpdated") + " " + formatDate(o.generatedAt, locale)} accent="primary" />
        </div>

        {/* last payment line */}
        <div className="glass-card flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <Coins className="size-4 text-amber-500" />
            {t("admin.lastPayment")}:
          </span>
          <span className="font-mono text-xs font-bold" dir="ltr">
            {o.revenue.lastPaymentAt ? formatDate(o.revenue.lastPaymentAt, locale) : t("admin.never")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs font-bold"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
              queryClient.invalidateQueries({ queryKey: ["admin-users"] });
              queryClient.invalidateQueries({ queryKey: ["admin-payments"] });
            }}
          >
            <RefreshCw className={cn("size-3.5", query.isFetching && "animate-spin")} />
            {query.isFetching ? t("admin.refreshing") : t("admin.refresh")}
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------- tab: users ---------------- */

  function UsersTab() {
    const [offset, setOffset] = useState(0);

    const query = useQuery<{ total: number; users: AdminUser[] }>({
      queryKey: ["admin-users", offset],
      queryFn: async () => {
        const res = await fetch(`/api/admin/users?limit=${PAGE_SIZE}&offset=${offset}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "ERROR");
        return { total: data.total as number, users: data.users as AdminUser[] };
      },
      staleTime: 30_000,
      retry: 1,
    });

    const shown = offset + (query.data?.users.length ?? 0);
    const hasMore = shown < (query.data?.total ?? 0);

    return (
      <div className="glass-card overflow-hidden">
        {query.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : query.isError || !query.data ? (
          <div className="p-8 text-center text-sm font-bold text-muted-foreground">
            {t("admin.forbidden")}
          </div>
        ) : query.data.users.length === 0 ? (
          <div className="grid place-items-center p-12 text-center">
            <Users className="mb-2 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("admin.noUsers")}</p>
          </div>
        ) : (
          <>
            <div className="nice-scroll max-h-[30rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-popover/95 backdrop-blur">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("admin.colUser")}</TableHead>
                    <TableHead className="text-xs">{t("admin.colJoined")}</TableHead>
                    <TableHead className="text-xs">{t("admin.colLastLogin")}</TableHead>
                    <TableHead className="hidden text-xs sm:table-cell">{t("admin.colLogins")}</TableHead>
                    <TableHead className="text-xs">{t("admin.colPass")}</TableHead>
                    <TableHead className="text-xs">{t("admin.colSpent")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.users.map((u) => (
                    <TableRow key={u.address} className="text-xs">
                      <TableCell>
                        <AddrCell address={u.address} />
                      </TableCell>
                      <TableCell className="font-mono">{formatDate(u.createdAt, locale)}</TableCell>
                      <TableCell className="font-mono">{formatDate(u.lastLoginAt, locale)}</TableCell>
                      <TableCell className="hidden font-mono sm:table-cell">{u.loginCount}</TableCell>
                      <TableCell>
                        {u.activePass ? (
                          <Badge
                            variant="outline"
                            className="gap-1 bg-buy/10 px-1.5 font-black text-buy ring-buy/30"
                          >
                            <KeyRound className="size-3" />
                            {u.activePass.lifetime
                              ? "∞"
                              : t("admin.daysLeft", { n: String(u.activePass.daysLeft) })}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/60">{t("admin.noPass")}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono font-bold" dir="ltr">
                        {formatPengu(u.totalSpentPengu)}
                        <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                          PENGU
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <TableFooterBar
              shown={shown}
              total={query.data.total}
              hasMore={hasMore}
              loading={query.isFetching}
              onLoadMore={() => setOffset(shown)}
            />
          </>
        )}
      </div>
    );
  }

  /* ---------------- tab: payments ---------------- */

  function PaymentsTab() {
    const { t } = useI18n();
    const [offset, setOffset] = useState(0);

    const query = useQuery<{ total: number; payments: AdminPayment[] }>({
      queryKey: ["admin-payments", offset],
      queryFn: async () => {
        const res = await fetch(`/api/admin/payments?limit=${PAGE_SIZE}&offset=${offset}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "ERROR");
        return { total: data.total as number, payments: data.payments as AdminPayment[] };
      },
      staleTime: 30_000,
      retry: 1,
    });

    const shown = offset + (query.data?.payments.length ?? 0);
    const hasMore = shown < (query.data?.total ?? 0);

    return (
      <div className="glass-card overflow-hidden">
        {query.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : query.isError || !query.data ? (
          <div className="p-8 text-center text-sm font-bold text-muted-foreground">
            {t("admin.forbidden")}
          </div>
        ) : query.data.payments.length === 0 ? (
          <div className="grid place-items-center p-12 text-center">
            <Coins className="mb-2 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("admin.noPayments")}</p>
          </div>
        ) : (
          <>
            <div className="nice-scroll max-h-[30rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-popover/95 backdrop-blur">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">{t("admin.colTx")}</TableHead>
                    <TableHead className="text-xs">{t("admin.colProduct")}</TableHead>
                    <TableHead className="text-xs">{t("admin.colAmount")}</TableHead>
                    <TableHead className="hidden text-xs sm:table-cell">{t("admin.colFrom")}</TableHead>
                    <TableHead className="text-xs">{t("admin.colDate")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.payments.map((p) => (
                    <TableRow key={p.txHash} className="text-xs">
                      <TableCell>
                        <a
                          href={explorerTxUrl(p.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono font-semibold text-primary underline-offset-2 hover:underline"
                          dir="ltr"
                          title={t("admin.viewOnExplorer")}
                        >
                          {shortTx(p.txHash)}
                          <ExternalLink className="size-3 opacity-60" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="px-1.5 font-bold">
                          {PRODUCT_LABEL_KEY[p.product] ? t(PRODUCT_LABEL_KEY[p.product]) : p.product}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono font-black" dir="ltr">
                        {formatPengu(p.amountToken)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <AddrCell address={p.fromAddress} />
                      </TableCell>
                      <TableCell className="font-mono">{formatDate(p.verifiedAt, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <TableFooterBar
              shown={shown}
              total={query.data.total}
              hasMore={hasMore}
              loading={query.isFetching}
              onLoadMore={() => setOffset(shown)}
            />
          </>
        )}
      </div>
    );
  }
}

/* ------------------------------------------------------------------ */
/* KpiCard — accent-tinted stat card                                    */
/* ------------------------------------------------------------------ */

const ACCENTS: Record<string, string> = {
  primary: "text-primary bg-primary/10 ring-primary/25",
  buy: "text-buy bg-buy/10 ring-buy/25",
  sell: "text-sell bg-sell/10 ring-sell/25",
  hold: "text-hold bg-hold/10 ring-hold/25",
  amber: "text-amber-500 bg-amber-500/10 ring-amber-500/25 dark:text-amber-400",
};

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent = "primary",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: keyof typeof ACCENTS | string;
}) {
  return (
    <div className="group rounded-xl border border-border/60 bg-card/40 px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card/70 hover:shadow-[0_6px_24px_-8px_rgba(45,212,191,0.28)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg ring-1 transition-transform duration-200 group-hover:scale-110",
            ACCENTS[accent] ?? ACCENTS.primary,
          )}
        >
          {icon}
        </span>
      </div>
      <div className="mt-2 font-mono text-2xl font-black leading-none" dir="ltr">
        {value}
      </div>
      {sub && <div className="mt-1.5 truncate text-[10px] text-muted-foreground/80">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AddrCell — short mono address + copy + explorer link                 */
/* ------------------------------------------------------------------ */

function AddrCell({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }, [address]);

  return (
    <span className="inline-flex items-center gap-1" dir="ltr">
      <a
        href={explorerAddressUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono font-semibold text-primary underline-offset-2 hover:underline"
        title={address}
      >
        {shortAddr(address)}
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label={`copy ${shortAddr(address)}`}
        className="grid size-5 place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? (
          <Check className="size-3 text-buy" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* TableFooterBar — shown/total + load more                            */
/* ------------------------------------------------------------------ */

function TableFooterBar({
  shown,
  total,
  hasMore,
  loading,
  onLoadMore,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-card/30 px-4 py-3">
      <span className="text-[11px] font-medium text-muted-foreground">
        {t("admin.showing", { shown: String(shown), total: String(total) })}
      </span>
      {hasMore && (
        <Button
          size="sm"
          variant="outline"
          onClick={onLoadMore}
          disabled={loading}
          className="gap-1.5 px-4 font-bold"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Users className="size-3.5" />}
          {loading ? t("admin.loadingMore") : t("admin.loadMore")}
        </Button>
      )}
    </div>
  );
}
