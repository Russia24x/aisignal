/**
 * Access Pass catalog — the single source of truth for the tariff (v2).
 *
 * Model (decided 2026-08, "no session keys" edition):
 *   - FREE tier: wallet registration + login + browsing (live market,
 *     track record, consensus teaser, dashboard) — WITHOUT signal content.
 *   - PAID passes: one simple dimension — duration. Every pass unlocks the
 *     same thing (the full daily signal); only the validity window differs.
 *
 * Tariff (PENGU, exactly as specified by the product owner):
 *   PASS_1D        1 day     10 PENGU
 *   PASS_7D        7 days     5 PENGU
 *   PASS_30D      30 days    30 PENGU
 *   PASS_365D    365 days   100 PENGU
 *   PASS_LIFETIME  ∞       1500 PENGU
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
  /** Price in whole PENGU units (18 decimals applied at payment time). */
  pricePengu: number;
}

/** The catalog. Order = display order on the pricing grid. */
export const ACCESS_PASSES: readonly AccessPassDef[] = [
  { id: "PASS_1D", days: 1, pricePengu: 10 },
  { id: "PASS_7D", days: 7, pricePengu: 5 },
  { id: "PASS_30D", days: 30, pricePengu: 30 },
  { id: "PASS_365D", days: 365, pricePengu: 100 },
  { id: "PASS_LIFETIME", days: null, pricePengu: 1500 },
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
}
