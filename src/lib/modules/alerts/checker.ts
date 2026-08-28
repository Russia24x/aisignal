/**
 * Price-alert checker — runs whenever the market module refreshes its
 * snapshot. Evaluates all ACTIVE PriceAlerts against the latest PENGU
 * price and marks matching ones as triggered.
 *
 * Returned stats help observability / metrics.
 *
 * @module lib/modules/alerts/checker
 */
import { db } from "@/lib/db";

export interface AlertCheckResult {
  checked: number;
  triggered: number;
  /** ids of alerts that fired during this check */
  firedIds: string[];
}

/**
 * Evaluate all active alerts against a fresh price snapshot.
 * Idempotent: once an alert has fired, it stays `active=false`.
 */
export async function checkAlerts(priceUsd: number): Promise<AlertCheckResult> {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return { checked: 0, triggered: 0, firedIds: [] };
  }

  const active = await db.priceAlert.findMany({
    where: { active: true },
    select: { id: true, direction: true, target: true },
  });

  if (active.length === 0) {
    return { checked: 0, triggered: 0, firedIds: [] };
  }

  const firedIds: string[] = [];
  for (const a of active) {
    const hit =
      (a.direction === "ABOVE" && priceUsd >= a.target) ||
      (a.direction === "BELOW" && priceUsd <= a.target);
    if (hit) firedIds.push(a.id);
  }

  if (firedIds.length > 0) {
    await db.priceAlert.updateMany({
      where: { id: { in: firedIds } },
      data: { active: false, triggeredAt: new Date(), triggeredPrice: priceUsd },
    });
  }

  return { checked: active.length, triggered: firedIds.length, firedIds };
}
