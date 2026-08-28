/**
 * Access Pass catalog — the single source of truth for the tariff (v3).
 *
 * Model (session-key-free, see docs/ACCESS-MODEL.md):
 *   - FREE tier: wallet registration + login + browsing (live market,
 *     track record, consensus teaser, dashboard) — WITHOUT signal content.
 *   - PAID passes: one simple dimension — duration. Every pass unlocks the
 *     same thing (the full daily signal); only the validity window differs.
 *
 * Tariff v3 — balanced & stepped (product-owner decision 2026-08):
 *   Anchor: 1 day = 10 PENGU (list price). Longer passes get a stepped
 *   duration discount, capped at 30%:
 *
 *     Pass          Days    List (= days × 10)   Discount   Price   ≈/day
 *     PASS_1D         1            10               0%        10     10.0
 *     PASS_7D         7            70              10%        63      9.0
 *     PASS_30D       30           300              20%       240      8.0
 *     PASS_365D     365          3650              30%      2555      7.0
 *     PASS_LIFETIME   ∞     7300 (2y ref)          30%      5110      —
 *
 *   The per-day staircase 10 → 9 → 8 → 7 PENGU makes the value of each
 *   step explicit; the lifetime pass is priced at exactly 2× the annual
 *   pass (≈ 6.7 PENGU/day for the first two years, free forever after).
 *
 * Payments are plain ERC-20 `transfer()` calls to the treasury, verified
 * server-side against the Abstract RPC (see lib/modules/access/payments.ts).
 * NO session keys, NO token approvals, NO allowances — deliberately, to stay
 * outside Abstract's session-key review policies. See docs/ACCESS-MODEL.md
 * for the future session-key integration path.
 *
 * This module is intentionally dependency-free so it can be imported from
 * BOTH server code and client components.
 *
 * @module lib/modules/access/passes
 */

export type AccessPassId =
  | "PASS_1D"
  | "PASS_7D"
  | "PASS_30D"
  | "PASS_365D"
  | "PASS_LIFETIME";

export interface AccessPassDef {
  id: AccessPassId;
  /** Grant duration in days. `null` = lifetime (no expiry in practice). */
  days: number | null;
  /** List price before the duration discount (reference: 10 PENGU/day). */
  basePricePengu: number;
  /** Stepped duration discount in percent (0…30, hard-capped at 30). */
  discountPct: number;
  /** Final price after discount, in whole PENGU (18 decimals at payment). */
  pricePengu: number;
}

/** Anchor list price for one day of access. */
export const PRICE_PER_DAY_PENGU = 10;

/** Maximum duration discount (product-owner rule: "پلکانی تا سقف ۳۰٪ تخفیف"). */
export const MAX_DISCOUNT_PCT = 30;

/** The catalog. Order = display order on the pricing grid. */
export const ACCESS_PASSES: readonly AccessPassDef[] = [
  { id: "PASS_1D", days: 1, basePricePengu: 10, discountPct: 0, pricePengu: 10 },
  { id: "PASS_7D", days: 7, basePricePengu: 70, discountPct: 10, pricePengu: 63 },
  { id: "PASS_30D", days: 30, basePricePengu: 300, discountPct: 20, pricePengu: 240 },
  { id: "PASS_365D", days: 365, basePricePengu: 3650, discountPct: 30, pricePengu: 2555 },
  { id: "PASS_LIFETIME", days: null, basePricePengu: 7300, discountPct: 30, pricePengu: 5110 },
] as const;

/** Days stored for a lifetime grant (≈100 years — practically forever). */
export const LIFETIME_GRANT_DAYS = 36500;

export function passById(id: string): AccessPassDef | null {
  return ACCESS_PASSES.find((p) => p.id === id) ?? null;
}

export function isLifetimePass(id: string): boolean {
  return id === "PASS_LIFETIME";
}

/** Per-day price for value framing (null for day/lifetime tiers). */
export function perDayPrice(pass: AccessPassDef): number | null {
  if (pass.days === null || pass.days <= 1) return null;
  return pass.pricePengu / pass.days;
}

/* ------------------------------------------------------------------ */
/* Client-safe DTO types (mirrored by the server entitlements module)  */
/* ------------------------------------------------------------------ */

/** The active access grant as returned by /api/auth/session. */
export interface ActiveGrantDTO {
  /** PASS_* product id (or a legacy product id for pre-v2 grants). */
  product: string;
  expiresAt: string;
  /** true when the grant has no practical expiry (PASS_LIFETIME). */
  lifetime: boolean;
}

/** Entitlements snapshot — answers "what can this user see right now?". */
export interface EntitlementsDTO {
  authenticated: boolean;
  address: string | null;
  /**
   * Free tier: any authenticated (registered) user can enter and browse.
   * Kept for API shape compatibility — always equals `authenticated`.
   */
  platformAccess: boolean;
  /** Has an active (non-expired) access pass → can read full signals. */
  signalAccess: boolean;
  activeGrant: ActiveGrantDTO | null;
  subscriptionDaysLeft: number;
  /** true when this wallet is a configured owner (ADMIN_ADDRESSES). */
  admin: boolean;
}
