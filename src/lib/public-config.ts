/**
 * Public (client-safe) configuration — NEXT_PUBLIC_* vars only.
 * Server-only config lives in lib/config.ts.
 *
 * @module lib/public-config
 */
function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const publicConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || "PenguSignals",
  chainId: num(process.env.NEXT_PUBLIC_CHAIN_ID, 2741),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet.abs.xyz",
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL || "https://abscan.org",
  penguToken: (process.env.NEXT_PUBLIC_PENGU_TOKEN || "0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62").toLowerCase() as `0x${string}`,
  treasury: (process.env.NEXT_PUBLIC_TREASURY || "0x60Df4E186364c3a49A550Aee29Da1d5fe3658818").toLowerCase() as `0x${string}`,
  pricePlatformAccess: num(process.env.NEXT_PUBLIC_PRICE_PLATFORM_ACCESS, 5),
  priceDayPass: num(process.env.NEXT_PUBLIC_PRICE_DAY_PASS, 1),
  defaultLocale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE || "fa",
  supportedLocales: (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES || "fa,en").split(","),
} as const;

/** ERC-20 PENGU metadata (verified on-chain: 18 decimals). */
export const PENGU_DECIMALS = 18;

/** Format a PENGU amount from base units to display units. */
export function formatPengu(raw: bigint | undefined | null): string {
  if (raw === null || raw === undefined) return "0";
  return (Number(raw) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 });
}
