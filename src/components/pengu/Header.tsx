"use client";

/**
 * Sticky top navigation: brand, live price pill, language switch, wallet.
 *
 * @module components/pengu/Header
 */
import { useState } from "react";
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
import { ChevronDown, Globe, Loader2, LogOut, Snowflake, Wallet } from "lucide-react";
import { AbstractProfile } from "@/components/abstract/AbstractProfile";
import { cn } from "@/lib/utils";

export function Header() {
  const { t, locale, setLocale } = useI18n();
  const { address, entitlements, signingIn, login, signIn, signOut, walletStatus } = useAuth();
  const { data } = useMarket();
  const [menuOpen, setMenuOpen] = useState(false);

  const price = data?.snapshot.priceUsd;
  const change = data?.snapshot.change24h ?? 0;

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/70 backdrop-blur-xl">
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
                {entitlements.platformAccess ? "✅ " : "🔒 "}
                {t("nav.dashboard")}
              </div>
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
          <Button onClick={() => signIn()} size="sm" disabled={signingIn} className="gap-2 font-bold">
            {signingIn ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
            <span className="hidden sm:inline">{signingIn ? t("wallet.signing") : t("wallet.signInTitle")}</span>
          </Button>
        )}
      </div>
    </header>
  );
}
