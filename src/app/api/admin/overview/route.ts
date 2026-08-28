/**
 * GET /api/admin/overview — platform KPI snapshot for the owner dashboard.
 *
 * GATE: requires an authenticated admin session (ADMIN_ADDRESSES env);
 * 403 FORBIDDEN for everyone else (including normal authenticated users).
 *
 * Response shape:
 *   {
 *     ok: true,
 *     overview: {
 *       users: { total, new7d, activePass, logins7d },
 *       revenue: { totalPengu, paymentsCount, payments7d, lastPaymentAt },
 *       signals: { total, open, wins, losses, winRate },
 *       alerts: { active, triggered },
 *       generatedAt: string
 *     }
 *   }
 *
 * All numbers come from indexed aggregate queries; the whole payload is a
 * handful of cheap SQLite/D1 aggregates.
 *
 * @module app/api/admin/overview
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { isAdminSession } from "@/lib/security/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = guard(req, "signal");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  const [
    totalUsers,
    newUsers7d,
    logins7dAgg,
    totalPayments,
    payments7d,
    revenueAgg,
    lastPayment,
    activeGrantRows,
    signalsTotal,
    signalsOpen,
    signalsWins,
    signalsLosses,
    alertsActive,
    alertsTriggered,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: d7 } } }),
    db.user.aggregate({ _sum: { loginCount: true } }),
    db.payment.count({ where: { status: "VERIFIED" } }),
    db.payment.count({ where: { status: "VERIFIED", verifiedAt: { gte: d7 } } }),
    db.payment.aggregate({ _sum: { amountToken: true }, where: { status: "VERIFIED" } }),
    db.payment.findFirst({
      where: { status: "VERIFIED" },
      orderBy: { verifiedAt: "desc" },
      select: { verifiedAt: true },
    }),
    // distinct users with a live pass
    db.accessGrant.findMany({
      where: { expiresAt: { gt: now } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.signal.count(),
    db.signal.count({ where: { outcome: "OPEN" } }),
    db.signal.count({ where: { outcome: "WIN" } }),
    db.signal.count({ where: { outcome: "LOSS" } }),
    db.priceAlert.count({ where: { active: true } }),
    db.priceAlert.count({ where: { triggeredAt: { not: null } } }),
  ]);

  const closed = signalsWins + signalsLosses;
  const winRate = closed > 0 ? Math.round((signalsWins / closed) * 100) : 0;

  return NextResponse.json(
    {
      ok: true,
      overview: {
        users: {
          total: totalUsers,
          new7d: newUsers7d,
          activePass: activeGrantRows.length,
          logins7d: logins7dAgg._sum.loginCount ?? 0,
        },
        revenue: {
          totalPengu: revenueAgg._sum.amountToken ?? 0,
          paymentsCount: totalPayments,
          payments7d,
          lastPaymentAt: lastPayment?.verifiedAt.toISOString() ?? null,
        },
        signals: {
          total: signalsTotal,
          open: signalsOpen,
          wins: signalsWins,
          losses: signalsLosses,
          winRate,
        },
        alerts: {
          active: alertsActive,
          triggered: alertsTriggered,
        },
        generatedAt: now.toISOString(),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
