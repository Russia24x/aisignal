/**
 * Access Pass catalog — the single source of truth for the tariff (v4).
 *
 * Model (stateless, target plan §8):
 *   - FREE tier: wallet login + browsing (live market, track record,
 *     consensus teaser, dashboard) — WITHOUT signal content.
 *   - PAID passes: one simple dimension — duration. Every pass unlocks the
 *     same thing (the full multi-timeframe signal); only validity differs.
 *
 * Tariff v4 — aligned with the target architecture plan:
 *
 *     Pass          Days    Price (PENGU)
 *     PASS_1D         1          10
 *     PASS_7D         7          50
 *     PASS_30D       30         300
 *     PASS_365D     365        1500
 *     PASS_LIFETIME   ∞        3000   (2× annual, per the established rule)
 *
 * Prices live in code (NOT in a database) — the plan §8: "قیمت اشتراک اصلاً
 * در Database نباشد … داخل کد یا configuration نسخه Worker".
 *
 * Entitlements are NOT stored anywhere: a verified payment mints a signed
 * claim into the HMAC session; the chain itself is the source of truth for
 * recovery (see lib/modules/access/restore.ts).
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
  /** Price in whole PENGU (18 decimals at payment). */
  pricePengu: number;
}

/** The catalog. Order = display order on the pricing grid. */
export const ACCESS_PASSES: readonly AccessPassDef[] = [
  { id: "PASS_1D", days: 1, pricePengu: 10 },
  { id: "PASS_7D", days: 7, pricePengu: 50 },
  { id: "PASS_30D", days: 30, pricePengu: 300 },
  { id: "PASS_365D", days: 365, pricePengu: 1500 },
  { id: "PASS_LIFETIME", days: null, pricePengu: 3000 },
] as const;

/** Days stored for a lifetime grant (≈100 years — practically forever). */
export const LIFETIME_GRANT_DAYS = 36500;

/** Milliseconds in one day — grant math is pure arithmetic. */
export const DAY_MS = 24 * 3600 * 1000;

export function passById(id: string): AccessPassDef | null {
  return ACCESS_PASSES.find((p) => p.id === id) ?? null;
}

export function isLifetimePass(id: string): boolean {
  return id === "PASS_LIFETIME";
}

/** Per-day price for value framing (null for day/lifetime tiers). */
export function perDayPrice(pass: AccessPassDef): number | null {
  if (pass.days === null || pass.days <= 1) return null;
  return Math.round((pass.pricePengu / pass.days) * 10) / 10;
}

/**
 * Map a PENGU amount to the largest pass it can buy (deterministic — used by
 * the on-chain recovery scan, where no client-declared product exists).
 * Returns null when the amount is below the cheapest pass.
 */
export function passForAmount(amountPengu: number): AccessPassDef | null {
  let best: AccessPassDef | null = null;
  for (const p of ACCESS_PASSES) {
    if (amountPengu >= p.pricePengu) {
      if (!best || p.pricePengu > best.pricePengu) best = p;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Client-safe DTO types (mirrored by the server entitlements module)  */
/* ------------------------------------------------------------------ */

/** The active access entitlement as returned by /api/auth/session. */
export interface ActiveGrantDTO {
  /** PASS_* product id the entitlement was minted from. */
  product: string;
  expiresAt: string;
  /** true when the grant has no practical expiry (PASS_LIFETIME). */
  lifetime: boolean;
  /** payment tx that minted this entitlement (provenance). */
  txHash?: string;
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
