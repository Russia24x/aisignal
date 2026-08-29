/**
 * GET /api/payment/history — the authenticated user's payment history.
 *
 * v4 STATELESS: read straight from the chain (ERC-20 transfers from the
 * session wallet to the treasury, last 45 days, cached 10 min per wallet).
 * Native-ETH payments emit no logs and therefore do not appear here —
 * their effect is visible through the active entitlement (session claim).
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { scanPayments } from "@/lib/modules/access/restore";
import { passForAmount } from "@/lib/modules/access/passes";

export async function GET(req: NextRequest) {
  const limited = guard(req, "payment");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const payments = await scanPayments(session.addr, 45);
    return NextResponse.json({
      ok: true,
      payments: [...payments]
        .reverse()
        .map((p) => ({
          txHash: p.txHash,
          token: p.token,
          product: passForAmount(p.amountToken)?.id ?? null,
          amountToken: p.amountToken,
          status: "VERIFIED",
          verifiedAt: new Date(p.blockTimestamp).toISOString(),
        })),
    });
  } catch {
    // RPC hiccup — an empty list is honest and the UI degrades gracefully
    return NextResponse.json({ ok: true, payments: [] });
  }
}
