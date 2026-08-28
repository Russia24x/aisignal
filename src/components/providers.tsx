"use client";

/**
 * Global client-side providers:
 *  - I18nProvider     → locale + RTL/LTR
 *  - ThemeProvider    → light/dark
 *  - AbstractWalletProvider → Abstract Global Wallet + wagmi + react-query
 *
 * The chain and RPC are env-driven (see lib/public-config.ts).
 *
 * The AGW network-resilience bridge (lib/agw-bridge) must be installed
 * BEFORE the wallet SDK performs its first provider-details fetch — module
 * scope (client only) guarantees that ordering.
 *
 * @module components/Providers
 */
import React, { useMemo } from "react";
import { ThemeProvider } from "next-themes";
import { http } from "viem";
import { abstract } from "viem/chains";
import { AbstractWalletProvider } from "@abstract-foundation/agw-react";
import { QueryClient } from "@tanstack/react-query";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/pengu/AuthProvider";
import { publicConfig } from "@/lib/public-config";
import { installAgwBridge } from "@/lib/agw-bridge";

// Install before any AGW SDK code runs (client only; idempotent).
if (typeof window !== "undefined") installAgwBridge();

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);

  // STABLE transport: AbstractWalletProvider rebuilds the whole wagmi config
  // (new store → every hook resets to "disconnected") whenever its `transport`
  // memo dep changes. `http(url)` returns a new function per call, so an
  // inline prop made the config fragile to re-renders — memoize it once.
  const transport = useMemo(() => http(publicConfig.rpcUrl), [publicConfig.rpcUrl]);

  return (
    <I18nProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <AbstractWalletProvider
          chain={abstract}
          transport={transport}
          queryClient={queryClient}
        >
          {/* SINGLE shared auth/session state: every useAuth() consumer
              (Header, gates, pricing, dashboard, alerts, payment dialog)
              reads this one instance — sign-in / payment / connect anywhere
              updates every section live, no reload needed. */}
          <AuthProvider>
            {children}
            <Toaster position="top-center" closeButton richColors />
          </AuthProvider>
        </AbstractWalletProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
