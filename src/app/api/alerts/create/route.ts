/**
 * POST /api/alerts — create a new price alert for the authenticated user.
 *
 * Body:
 *   { direction: "ABOVE" | "BELOW", target: number (USD price > 0) }
 *
 * Limits:
 *   - 10 active alerts per user (reject with 409 if exceeded)
 *   - target must be a finite positive number
 *
 * @module app/api/alerts/create
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_ACTIVE_PER_USER = 10;

const bodySchema = z.object({
  direction: z.enum(["ABOVE", "BELOW"]),
  target: z.number().positive().finite(),
});

export async function POST(req: NextRequest) {
  const limited = guard(req, "payment");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 422 });
  }

  // cap active alerts per user to bound DB size + noisy users
  const activeCount = await db.priceAlert.count({
    where: { userId: session.sub, active: true },
  });
  if (activeCount >= MAX_ACTIVE_PER_USER) {
    return NextResponse.json(
      { ok: false, error: "ALERT_LIMIT_REACHED", limit: MAX_ACTIVE_PER_USER },
      { status: 409 },
    );
  }

  const alert = await db.priceAlert.create({
    data: {
      userId: session.sub,
      direction: body.direction,
      target: body.target,
      active: true,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      alert: {
        id: alert.id,
        direction: alert.direction,
        target: alert.target,
        active: alert.active,
        createdAt: alert.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
