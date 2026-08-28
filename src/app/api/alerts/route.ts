/**
 * GET /api/alerts — list the authenticated user's price alerts.
 *
 * Auth required (401 if not signed in). Returns both active and recently
 * triggered alerts (last 30 days), sorted by createdAt desc.
 *
 * Response:
 *   { ok, alerts: [{ id, direction, target, active, triggeredAt, triggeredPrice, createdAt }] }
 *
 * @module app/api/alerts
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = guard(req, "signal");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const alerts = await db.priceAlert.findMany({
    where: { userId: session.sub, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    {
      ok: true,
      alerts: alerts.map((a) => ({
        id: a.id,
        direction: a.direction,
        target: a.target,
        active: a.active,
        triggeredAt: a.triggeredAt?.toISOString() ?? null,
        triggeredPrice: a.triggeredPrice,
        createdAt: a.createdAt.toISOString(),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
