/**
 * GET /api/payment/history — the authenticated user's payment history.
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const limited = guard(req, "payment");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const payments = await db.payment.findMany({
    where: { userId: session.sub },
    orderBy: { verifiedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    ok: true,
    payments: payments.map((p) => ({
      txHash: p.txHash,
      product: p.product,
      amountToken: p.amountToken,
      status: p.status,
      verifiedAt: p.verifiedAt.toISOString(),
    })),
  });
}
