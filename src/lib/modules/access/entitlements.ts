/**
 * Access entitlements — answers "what can this user see right now?"
 *
 * v4 STATELESS: entitlements live INSIDE the HMAC-signed session as an `ent`
 * claim (minted only after on-chain payment verification). No database,
 * no lookups — checking access is pure cryptography + clock comparison.
 *
 * Access model (target plan §1, §8–§10):
 *  - FREE (any signed-in wallet): entry, live market, track record,
 *    consensus teaser, dashboard — everything EXCEPT signal content
 *  - Access passes (PASS_1D … PASS_LIFETIME): unlock the full multi-
 *    timeframe signal for their duration
 *
 * Recovery after cookies are cleared: the chain is the source of truth —
 * see lib/modules/access/restore.ts (eth_getLogs treasury scan).
 *
 * @module lib/modules/access/entitlements
 */
import type { EntitlementClaim, SessionPayload } from "@/lib/security/session";
import type { EntitlementsDTO } from "./passes";
import { ACCESS_PASSES, isLifetimePass, DAY_MS } from "./passes";

export type Entitlements = EntitlementsDTO;

function anonymous(): Entitlements {
  return {
    authenticated: false,
    address: null,
    platformAccess: false,
    signalAccess: false,
    activeGrant: null,
    subscriptionDaysLeft: 0,
  };
}

/** Derive entitlements from a session payload (pure — no I/O). */
export function entitlementsFromSession(session: SessionPayload | null): Entitlements {
  if (!session) return anonymous();
  const ent = session.ent ?? null;
  const active = ent !== null && (ent.lifetime || ent.expiresAt > Date.now());
  const daysLeft = ent
    ? Math.max(0, Math.ceil((ent.expiresAt - Date.now()) / DAY_MS))
    : 0;
  return {
    authenticated: true,
    address: session.addr,
    // free tier: registration IS entry — browsing is free,
    // signal content is what passes unlock
    platformAccess: true,
    signalAccess: active,
    activeGrant:
      ent && active
        ? {
            product: ent.product,
            expiresAt: new Date(ent.expiresAt).toISOString(),
            // `lifetime` is sticky by construction: verifyPayment and the
            // restore replay both preserve it across re-mints
            lifetime: ent.lifetime || isLifetimePass(ent.product),
            txHash: ent.txHash,
          }
        : null,
    subscriptionDaysLeft: daysLeft,
  };
}

/** The current session's entitlement claim (raw, for expiry-aware callers). */
export function currentClaim(session: SessionPayload | null): EntitlementClaim | null {
  return session?.ent ?? null;
}

export interface ProductInfo {
  id: string;
  pricePengu: number;
  days: number | null;
  lifetime: boolean;
}

/** The purchasable catalog — built from the shared pass definitions. */
export function productCatalog(): Record<string, ProductInfo> {
  const out: Record<string, ProductInfo> = {};
  for (const p of ACCESS_PASSES) {
    out[p.id] = {
      id: p.id,
      pricePengu: p.pricePengu,
      days: p.days,
      lifetime: p.days === null,
    };
  }
  return out;
}
