"use client";

/**
 * Sticky top navigation: brand, live price pill, language switch, wallet.
 *
 * @module components/pengu/Header
 */
import { useEffect, useState } from "react";
import { useBalance } from "wagmi";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { useMarket, fmt } from "./useMarket";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Copy, ExternalLink, Fuel, Globe, Loader2, LogOut, PenLine, Snowflake, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { publicConfig } from "@/lib/public-config";
import { AbstractProfile } from "@/components/abstract/AbstractProfile";
import { cn } from "@/lib/utils";

export function Header() {
  const { t, locale, setLocale } = useI18n();
  const { address, entitlements, signingIn, login, signIn, signOut, walletStatus, chainId, needsSignIn } = useAuth();
  const { data } = useMarket();
  const [menuOpen, setMenuOpen] = useState(false);

  // Scroll-depth cue: the header gains elevation (shadow + denser
  // backdrop) once the page actually scrolls — keeps the top edge airy
  // at rest, unmistakably "floating above content" mid-page.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Wallet balances for the dropdown (official ConnectWalletButton pattern —
  // build.abs.xyz/docs/authentication/connect-wallet-button shows the
  // connected wallet's balance alongside the address).
  const { data: ethBalance } = useBalance({ address });
  const { data: penguBalance } = useBalance({
    address,
    token: publicConfig.penguToken,
    chainId: publicConfig.chainId,
  });
  const fmtBal = (v: bigint | undefined, d = 4) =>
    v === undefined ? null : (Number(v) / 1e18).toLocaleString("en-US", { maximumFractionDigits: d });

  // AGW is Abstract-only by design, but wagmi still reports the connected
  // chain — surface a warning if it ever drifts from the configured chain
  // (e.g. misconfigured env or a non-AGW connector).
  const wrongNetwork = walletStatus === "connected" && chainId !== undefined && chainId !== publicConfig.chainId;

  /**
   * Sign in — failures toast centrally inside useAuth.signIn (single
   * source; this wrapper exists only to bind the click gesture).
   */
  const handleSignIn = () => {
    void signIn();
  };

  const price = data?.snapshot.priceUsd;
  const change = data?.snapshot.change24h ?? 0;

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border/50 bg-background/70 backdrop-blur-xl transition-shadow duration-300",
        scrolled && "header-scrolled bg-background/85",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        {/* Brand */}
        <a href="#top" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Snowflake className="size-5" />
          </span>
          <span className="text-base font-extrabold tracking-tight">
            Pengu<span className="text-primary">Signals</span>
          </span>
        </a>

        {/* Live price pill */}
        {price !== undefined && (
          <div
            className={cn(
              "ms-2 hidden items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 sm:flex",
              change >= 0 ? "tick-up" : "tick-down",
            )}
            dir="ltr"
          >
            <span className="relative grid place-items-center">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary pulse-ring" />
            </span>
            <span className="font-mono text-sm font-bold">{fmt.price(price)}</span>
            <span className={cn("font-mono text-xs font-semibold", change >= 0 ? "text-buy" : "text-sell")}>
              {fmt.pct(change)}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* Wrong-network warning (AGW should always be on Abstract) */}
        {wrongNetwork && (
          <span
            className="hidden items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-bold text-destructive sm:inline-flex"
            title={t("wallet.wrongNetwork")}
          >
            <TriangleAlert className="size-3.5" />
            <span className="font-mono" dir="ltr">#{chainId}</span>
          </span>
        )}

        {/* Language */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <Globe className="size-4" />
              <span className="text-xs font-bold uppercase">{locale}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLocale("fa")} className={cn(locale === "fa" && "text-primary")}>
              🇮🇷 فارسی
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLocale("en")} className={cn(locale === "en" && "text-primary")}>
              🇬🇧 English
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Wallet */}
        {walletStatus !== "connected" ? (
          <Button onClick={login} size="sm" className="gap-2 font-bold">
            <Wallet className="size-4" />
            <span className="hidden sm:inline">{t("nav.connect")}</span>
          </Button>
        ) : entitlements?.authenticated ? (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-2 font-mono">
                <AbstractProfile address={address} size="sm" showTooltip={false} className="-my-1" />
                {short(address!)}
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {entitlements.signalAccess ? "✅ " : "🔒 "}
                {t("nav.dashboard")}
              </div>
              {/* Balances — official ConnectWalletButton pattern */}
              <div
                className="mx-1 mb-1 grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-card/60 p-2"
                dir="ltr"
                aria-label={t("dashboard.penguBalance")}
              >
                <span className="flex items-center gap-1.5 text-[11px] font-bold" title={t("dashboard.penguBalance")}>
                  <Snowflake className="size-3.5 shrink-0 text-primary" />
                  <span className="font-mono">
                    {fmtBal(penguBalance?.value) ?? "—"}
                  </span>
                  <span className="text-muted-foreground">PENGU</span>
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-bold" title={t("dashboard.ethBalance")}>
                  <Fuel className="size-3.5 shrink-0 text-amber-500" />
                  <span className="font-mono">
                    {fmtBal(ethBalance?.value) ?? "—"}
                  </span>
                  <span className="text-muted-foreground">ETH</span>
                </span>
              </div>
              <DropdownMenuItem
                className="gap-2"
                onClick={() => {
                  navigator.clipboard
                    .writeText(address!)
                    .then(() => toast.success(t("dashboard.copied")))
                    .catch(() => undefined);
                  setMenuOpen(false);
                }}
              >
                <Copy className="size-4" />
                {t("dashboard.copyAddress")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`${publicConfig.explorerUrl}/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex cursor-pointer items-center gap-2"
                >
                  <ExternalLink className="size-4" />
                  {t("dashboard.viewOnExplorer")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`https://abs.xyz/profile/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex cursor-pointer items-center gap-2"
                >
                  <ExternalLink className="size-4" />
                  {t("dashboard.viewOnPortal")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                }}
                className="gap-2 text-destructive"
              >
                <LogOut className="size-4" />
                {t("nav.disconnect")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            onClick={handleSignIn}
            size="sm"
            disabled={signingIn}
            className={cn(
              "gap-2 font-bold",
              // Attention state: wallet connected but session not yet created.
              // A gentle ring + pulse draws the eye to the one required click
              // (signatures must be click-triggered — popup-blocker safety).
              needsSignIn &&
                "ring-2 ring-primary/60 ring-offset-2 ring-offset-background animate-[pulse-glow_2s_ease-in-out_infinite]",
            )}
            title={`${t("wallet.connected")}: ${address}\n${t("wallet.signInDesc")}`}
          >
            {signingIn ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PenLine className="size-4" />
            )}
            {/* The user must SEE the wallet is connected the instant the
                popup completes — the address is proof, no refresh needed
                (this was the exact "refresh to show connected" report). */}
            <AbstractProfile address={address} size="sm" showTooltip={false} className="-my-1" />
            <span className="font-mono text-xs" dir="ltr">
              {short(address!)}
            </span>
            <span className="hidden lg:inline">{signingIn ? t("wallet.signing") : t("wallet.signInTitle")}</span>
          </Button>
        )}
      </div>
    </header>
  );
}
