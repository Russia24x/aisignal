/**
 * GET /api/admin/payments?offset=0&limit=20 — paginated verified-payment log
 * for the owner dashboard (tx hash, product, amount, payer, timestamp).
 *
 * GATE: admin session only (ADMIN_ADDRESSES); 403 otherwise.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     total: number,
 *     payments: [{
 *       txHash, product, amountToken, fromAddress, toAddress,
 *       status, verifiedAt, blockNumber
 *     }]
 *   }
 *
 * @module app/api/admin/payments
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { isAdminSession } from "@/lib/security/admin";
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

  const [total, payments] = await Promise.all([
    db.payment.count(),
    db.payment.findMany({
      orderBy: { verifiedAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        txHash: true,
        product: true,
        amountToken: true,
        fromAddress: true,
        toAddress: true,
        status: true,
        verifiedAt: true,
        blockNumber: true,
      },
    }),
  ]);

  return NextResponse.json(
    {
      ok: true,
      total,
      payments: payments.map((p) => ({
        txHash: p.txHash,
        product: p.product,
        amountToken: p.amountToken,
        fromAddress: p.fromAddress,
        toAddress: p.toAddress,
        status: p.status,
        verifiedAt: p.verifiedAt.toISOString(),
        blockNumber: p.blockNumber !== null ? p.blockNumber.toString() : null,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
