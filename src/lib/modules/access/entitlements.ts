/**
 * Access entitlements — answers "what can this user see right now?"
 *
 * Access model:
 *  - Public: live market overview, signal preview (masked), track record
 *  - PLATFORM_ACCESS (5 PENGU, one-time): unlocks the dashboard / signal area
 *  - DAY_PASS (1 PENGU): today's full signal until end of UTC day (+2h grace)
 *  - SUBSCRIPTION (packs, 1 PENGU/day): continuous daily access
 *
 * @module lib/modules/access/entitlements
 */
import { db } from "@/lib/db";
import { serverConfig } from "@/lib/config";

export interface Entitlements {
  authenticated: boolean;
  address: string | null;
  platformAccess: boolean;
  signalAccess: boolean;
  activeGrant: {
    product: "DAY_PASS" | "SUBSCRIPTION";
    expiresAt: string;
  } | null;
  subscriptionDaysLeft: number;
}

export async function getEntitlements(userId: string | null): Promise<Entitlements> {
  if (!userId) {
    return {
      authenticated: false,
      address: null,
      platformAccess: false,
      signalAccess: false,
      activeGrant: null,
      subscriptionDaysLeft: 0,
    };
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return {
      authenticated: false,
      address: null,
      platformAccess: false,
      signalAccess: false,
      activeGrant: null,
      subscriptionDaysLeft: 0,
    };
  }

  const now = new Date();
  const grant = await db.accessGrant.findFirst({
    where: { userId, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });

  const daysLeft = grant
    ? Math.max(0, Math.ceil((grant.expiresAt.getTime() - now.getTime()) / (24 * 3600 * 1000)))
    : 0;

  return {
    authenticated: true,
    address: user.address,
    platformAccess: user.platformAccessAt !== null,
    signalAccess: grant !== null,
    activeGrant: grant
      ? { product: grant.product as "DAY_PASS" | "SUBSCRIPTION", expiresAt: grant.expiresAt.toISOString() }
      : null,
    subscriptionDaysLeft: daysLeft,
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
}

export function productCatalog(): Record<string, ProductInfo> {
  const packs = serverConfig.subscriptionPacks;
  const out: Record<string, ProductInfo> = {
    PLATFORM_ACCESS: { id: "PLATFORM_ACCESS", pricePengu: serverConfig.PRICE_PLATFORM_ACCESS, days: null },
    DAY_PASS: { id: "DAY_PASS", pricePengu: serverConfig.PRICE_DAY_PASS, days: 1 },
  };
  for (const p of packs) {
    out[p.id] = { id: p.id, pricePengu: p.price, days: p.days };
  }
  return out;
}
