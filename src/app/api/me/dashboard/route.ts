/**
 * GET /api/me/dashboard — per-user dashboard summary (access pass status,
 * payments, membership) for any AUTHENTICATED user. Entry and browsing are
 * free since the v2 access model; signal content itself stays server-gated.
 * Returns 401 if not authenticated.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     dashboard: {
 *       entitlements,            // full Entitlements object
 *       activeGrant: {           // null if no active pass
 *         product, startsAt, expiresAt, daysLeft, totalDays,
 *         progressPercent, lifetime
 *       } | null,
 *       payments: [...last5],    // { txHash, product, amountToken, status, verifiedAt }
 *       memberSince: string,     // account creation date
 *       paymentsCount: number,   // total verified payments
 *       daysLeft: number,
 *       totalSpentPengu: number,
 *     }
 *   }
 *
 * @module app/api/me/dashboard
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { getEntitlements } from "@/lib/modules/access/entitlements";
import { isLifetimePass, LIFETIME_GRANT_DAYS } from "@/lib/modules/access/passes";
import { db } from "@/lib/db";

// never cache a per-user dashboard response
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = guard(req, "signal");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const entitlements = await getEntitlements(session.sub);

  const now = new Date();

  // Active grant (the most-recently expiring one). We re-fetch it directly
  // (rather than reusing entitlements.activeGrant) because we also need
  // startsAt to draw a meaningful progress bar.
  const grant = await db.accessGrant.findFirst({
    where: { userId: session.sub, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });

  const lifetime = grant ? isLifetimePass(grant.product) : false;
  const totalDays = grant
    ? Math.max(1, Math.round((grant.expiresAt.getTime() - grant.startsAt.getTime()) / (24 * 3600 * 1000)))
    : 0;
  const daysLeft = grant
    ? Math.max(0, Math.ceil((grant.expiresAt.getTime() - now.getTime()) / (24 * 3600 * 1000)))
    : 0;
  const progressPercent = grant
    ? Math.max(0, Math.min(100, (daysLeft / totalDays) * 100))
    : 0;

  const [payments, spentAgg, countAgg, user] = await Promise.all([
    db.payment.findMany({
      where: { userId: session.sub, status: "VERIFIED" },
      orderBy: { verifiedAt: "desc" },
      take: 5,
    }),
    db.payment.aggregate({
      _sum: { amountToken: true },
      where: { userId: session.sub, status: "VERIFIED" },
    }),
    db.payment.count({
      where: { userId: session.sub, status: "VERIFIED" },
    }),
    db.user.findUnique({
      where: { id: session.sub },
      select: { createdAt: true },
    }),
  ]);

  return NextResponse.json(
    {
      ok: true,
      dashboard: {
        entitlements,
        activeGrant: grant
          ? {
              product: grant.product,
              startsAt: grant.startsAt.toISOString(),
              expiresAt: grant.expiresAt.toISOString(),
              daysLeft,
              totalDays: lifetime ? LIFETIME_GRANT_DAYS : totalDays,
              progressPercent,
              lifetime,
            }
          : null,
        payments: payments.map((p) => ({
          txHash: p.txHash,
          product: p.product,
          amountToken: p.amountToken,
          status: p.status,
          verifiedAt: p.verifiedAt.toISOString(),
        })),
        memberSince: (user?.createdAt ?? new Date()).toISOString(),
        paymentsCount: countAgg,
        daysLeft,
        totalSpentPengu: spentAgg._sum.amountToken ?? 0,
      },
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
