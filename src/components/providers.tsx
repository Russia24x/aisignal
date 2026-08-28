"use client";

/**
 * Global client-side providers:
 *  - I18nProvider     → locale + RTL/LTR
 *  - ThemeProvider    → light/dark
 *  - AbstractWalletProvider → Abstract Global Wallet + wagmi + react-query
 *
 * The chain and RPC are env-driven (see lib/public-config.ts).
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
import { publicConfig } from "@/lib/public-config";

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <I18nProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <AbstractWalletProvider
          chain={abstract}
          transport={http(publicConfig.rpcUrl)}
          queryClient={queryClient}
        >
          {children}
          <Toaster position="top-center" closeButton richColors />
        </AbstractWalletProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
