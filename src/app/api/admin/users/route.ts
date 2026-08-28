/**
 * GET /api/admin/users?offset=0&limit=20 — paginated user directory for the
 * owner dashboard. Each row carries the user's live pass state and lifetime
 * verified spend.
 *
 * GATE: admin session only (ADMIN_ADDRESSES); 403 otherwise.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     total: number,
 *     users: [{
 *       address, createdAt, lastLoginAt, loginCount,
 *       activePass: { product, expiresAt, daysLeft, lifetime } | null,
 *       totalSpentPengu: number, paymentsCount: number
 *     }]
 *   }
 *
 * Implementation note: 3 queries total (page of users, their live grants,
 * grouped payment sums) — never a per-user N+1.
 *
 * @module app/api/admin/users
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { isAdminSession } from "@/lib/security/admin";
import { isLifetimePass, LIFETIME_GRANT_DAYS } from "@/lib/modules/access/passes";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

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

  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));

  const now = new Date();

  const [total, users] = await Promise.all([
    db.user.count(),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      select: { id: true, address: true, createdAt: true, lastLoginAt: true, loginCount: true },
    }),
  ]);

  const userIds = users.map((u) => u.id);

  // latest live grant per user (grants stack — the max expiry wins)
  const [grants, spendRows] = await Promise.all([
    userIds.length
      ? db.accessGrant.findMany({
          where: { userId: { in: userIds }, expiresAt: { gt: now } },
          orderBy: { expiresAt: "desc" },
        })
      : Promise.resolve([]),
    userIds.length
      ? db.payment.groupBy({
          by: ["userId"],
          _sum: { amountToken: true },
          _count: { _all: true },
          where: { userId: { in: userIds }, status: "VERIFIED" },
        })
      : Promise.resolve([]),
  ]);

  // first live grant per userId (already sorted by expiresAt desc)
  const grantByUser = new Map<string, (typeof grants)[number]>();
  for (const g of grants) {
    if (!grantByUser.has(g.userId)) grantByUser.set(g.userId, g);
  }
  const spendByUser = new Map(spendRows.map((r) => [r.userId, r]));

  return NextResponse.json(
    {
      ok: true,
      total,
      users: users.map((u) => {
        const g = grantByUser.get(u.id) ?? null;
        const daysLeft = g
          ? Math.max(0, Math.ceil((g.expiresAt.getTime() - now.getTime()) / (24 * 3600 * 1000)))
          : 0;
        const spend = spendByUser.get(u.id);
        return {
          address: u.address,
          createdAt: u.createdAt.toISOString(),
          lastLoginAt: u.lastLoginAt.toISOString(),
          loginCount: u.loginCount,
          activePass: g
            ? {
                product: g.product,
                expiresAt: g.expiresAt.toISOString(),
                daysLeft,
                lifetime: isLifetimePass(g.product) || daysLeft >= LIFETIME_GRANT_DAYS - 366,
              }
            : null,
          totalSpentPengu: spend?._sum.amountToken ?? 0,
          paymentsCount: spend?._count._all ?? 0,
        };
      }),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
