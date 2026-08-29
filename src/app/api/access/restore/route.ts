/**
 * POST /api/access/restore — recover purchases from the chain.
 *
 * Target plan §9: "Database ❌ / Blockchain ✅" — when a paid user returns
 * with a fresh browser, we scan the chain (eth_getLogs) for their ERC-20
 * payments to the treasury, replay them chronologically (stacking
 * semantics) and mint the best entitlement into the session.
 *
 * Rate-limited tightly (RPC-expensive) and cached per wallet for 10 min.
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession, mintEntitlement } from "@/lib/security/session";
import { scanPayments, computeEntitlement } from "@/lib/modules/access/restore";
import { entitlementsFromSession } from "@/lib/modules/access/entitlements";
import { createLogger } from "@/lib/logger";

const log = createLogger("access:restore");

export async function POST(req: NextRequest) {
  const limited = guard(req, "restore");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const payments = await scanPayments(session.addr);
    const best = computeEntitlement(payments);

    // mint only when the chain says the user is BETTER off than the session
    const now = Date.now();
    const currentBest = session.ent?.expiresAt ?? 0;
    if (best && best.expiresAt > Math.max(currentBest, now)) {
      const minted = await mintEntitlement(best);
      if (minted) {
        log.info("entitlement restored from chain", {
          address: session.addr,
          product: best.product,
          payments: payments.length,
        });
        return NextResponse.json({
          ok: true,
          restored: true,
          entitlements: entitlementsFromSession(minted.payload),
          sessionToken: minted.token,
          paymentsFound: payments.length,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      restored: false,
      entitlements: entitlementsFromSession(session),
      paymentsFound: payments.length,
    });
  } catch (err) {
    log.warn("restore scan failed", { err: String(err) });
    return NextResponse.json({ ok: false, error: "SCAN_FAILED" }, { status: 502 });
  }
}
