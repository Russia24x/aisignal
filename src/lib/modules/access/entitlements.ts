/**
 * Access entitlements — answers "what can this user see right now?"
 *
 * Access model (v2 — session-key-free, see docs/ACCESS-MODEL.md):
 *  - FREE (any registered wallet): entry, live market, track record,
 *    consensus teaser, dashboard — everything EXCEPT signal content
 *  - Access passes (PASS_1D / PASS_7D / PASS_30D / PASS_365D /
 *    PASS_LIFETIME): unlock the full daily signal for their duration
 *
 * All grants stack: a new pass extends from the later of (now, current
 * expiry), so users never lose paid days by renewing early.
 *
 * @module lib/modules/access/entitlements
 */
import { db } from "@/lib/db";
import {
  ACCESS_PASSES,
  isLifetimePass,
  LIFETIME_GRANT_DAYS,
  type EntitlementsDTO,
} from "./passes";
import { isAdminAddress } from "@/lib/security/admin";

export type Entitlements = EntitlementsDTO;

function anonymous(): Entitlements {
  return {
    authenticated: false,
    address: null,
    platformAccess: false,
    signalAccess: false,
    activeGrant: null,
    subscriptionDaysLeft: 0,
    admin: false,
  };
}

export async function getEntitlements(userId: string | null): Promise<Entitlements> {
  if (!userId) return anonymous();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return anonymous();

  const now = new Date();
  const grant = await db.accessGrant.findFirst({
    where: { userId, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });

  const daysLeft = grant
    ? Math.max(
        0,
        Math.ceil((grant.expiresAt.getTime() - now.getTime()) / (24 * 3600 * 1000)),
      )
    : 0;

  return {
    authenticated: true,
    address: user.address,
    // free tier since v2: registration IS entry — browsing is free,
    // signal content is what passes unlock
    platformAccess: true,
    signalAccess: grant !== null,
    activeGrant: grant
      ? {
          product: grant.product,
          expiresAt: grant.expiresAt.toISOString(),
          lifetime: isLifetimePass(grant.product) || daysLeft >= LIFETIME_GRANT_DAYS - 366,
        }
      : null,
    subscriptionDaysLeft: daysLeft,
    admin: isAdminAddress(user.address),
  };
}

/** UTC day key for signals (e.g. "2026-06-30"). */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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
