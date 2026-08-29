/**
 * Payment token registry (target plan §7) — pay in PENGU, ETH or a
 * supported stablecoin; prices are denominated in PENGU and converted at
 * quote time via live market data.
 *
 *   - PENGU  : ERC-20 on Abstract (primary — the product currency)
 *   - ETH    : native Abstract transfers (every wallet holds it for gas)
 *   - USDC.e : ERC-20 on Abstract — registered but DISABLED by default
 *              (tiny on-chain liquidity today; flip `enabled` after
 *              verifying your treasury accepts it)
 *
 * Native transfers emit no event logs, so on-chain RECOVERY (scanning the
 * treasury) only works for ERC-20 tokens — see restore.ts. ETH payments
 * are still fully verifiable by tx hash.
 *
 * Registry data is server+client safe (addresses are public by nature).
 * The PENGU contract address is derived from the SAME env-driven config
 * the client uses (public-config) — a single source of truth, so a
 * testnet/mainnet switch cannot desync “what users pay” from “what the
 * verifier scans”. The literal below is only the production default.
 *
 * @module lib/modules/access/tokens
 */
import { publicConfig } from "@/lib/public-config";

export type PayTokenKind = "erc20" | "native";
export type PayTokenKey = "PENGU" | "ETH" | "USDC";

export interface PayTokenDef {
  key: PayTokenKey;
  kind: PayTokenKind;
  /** ERC-20 contract; null for the native asset. */
  address: string | null;
  decimals: number;
  symbol: string;
  /** only enabled tokens are offered in the payment dialog */
  enabled: boolean;
}

/** PENGU ERC-20 on Abstract mainnet (env-driven; verified: 18 decimals). */
export const PENGU_TOKEN = publicConfig.penguToken;
/** USDC.e (bridged) on Abstract mainnet — verified via RPC: 6 decimals. */
export const USDC_E_TOKEN = "0x84A71ccD554Cc1b02749b35d22F684CC8ec987e1".toLowerCase();

export const PAY_TOKENS: readonly PayTokenDef[] = [
  {
    key: "PENGU",
    kind: "erc20",
    address: PENGU_TOKEN,
    decimals: 18,
    symbol: "PENGU",
    enabled: true,
  },
  {
    key: "ETH",
    kind: "native",
    address: null,
    decimals: 18,
    symbol: "ETH",
    enabled: true,
  },
  {
    key: "USDC",
    kind: "erc20",
    address: USDC_E_TOKEN,
    decimals: 6,
    symbol: "USDC.e",
    enabled: false,
  },
] as const;

export function payTokenByKey(key: string): PayTokenDef | null {
  return PAY_TOKENS.find((t) => t.key === key && t.enabled) ?? null;
}

export function payTokenByAddress(address: string): PayTokenDef | null {
  const a = address.toLowerCase();
  return PAY_TOKENS.find((t) => t.enabled && t.address && t.address === a) ?? null;
}

/** Convert human amount → base units for a token's decimals. */
export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e15) {
    // toFixed() switches to exponential notation above 1e21 and prices are
    // whole PENGU ≤ 3000 — anything larger is a programming error
    throw new RangeError(`toBaseUnits: amount out of range (${amount})`);
  }
  const [int, frac = ""] = amount.toFixed(decimals).split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(int + fracPadded);
}

/** Convert base units → human amount. */
export function fromBaseUnits(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** ERC-20 Transfer event topic (recovery scan + payment verification). */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df524b3ef" as const;
