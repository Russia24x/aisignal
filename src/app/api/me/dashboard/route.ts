/**
 * GET /api/me/dashboard — per-user dashboard summary (access pass status,
 * payments) for any AUTHENTICATED user. Entry and browsing are free; signal
 * content itself stays server-gated. Returns 401 if not authenticated.
 *
 * v4 STATELESS: the entitlement comes from the signed session claim; the
 * payment list is a light on-chain scan (last 45 days, cached 10 min per
 * wallet). "memberSince" is the session issue time — there is no account
 * record anywhere.
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
 *       memberSince: string,     // session issue time (no account record exists)
 *       paymentsCount: number,   // on-chain payments found in the scan window
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
import { entitlementsFromSession } from "@/lib/modules/access/entitlements";
import { isLifetimePass, LIFETIME_GRANT_DAYS, DAY_MS, passForAmount } from "@/lib/modules/access/passes";
import { scanPayments } from "@/lib/modules/access/restore";
import { createLogger } from "@/lib/logger";

const log = createLogger("me:dashboard");

// never cache a per-user dashboard response
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = guard(req, "signal");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const entitlements = entitlementsFromSession(session);
  const ent = session.ent ?? null;
  const now = Date.now();
  const active = ent !== null && (ent.lifetime || ent.expiresAt > now);

  // sticky lifetime flag (a smaller later payment never downgrades it)
  const lifetime = active ? ent!.lifetime || isLifetimePass(ent!.product) : false;
  // the claim's grant span: payment block → expiry (honest after restore
  // and for stacked passes; falls back to mint time on legacy claims)
  const totalDays = active
    ? Math.max(1, Math.round((ent!.expiresAt - (ent!.paidAt || ent!.mintedAt)) / DAY_MS))
    : 0;
  const daysLeft = active ? Math.max(0, Math.ceil((ent!.expiresAt - now) / DAY_MS)) : 0;
  const progressPercent = active ? Math.max(0, Math.min(100, (daysLeft / Math.max(1, totalDays)) * 100)) : 0;

  // light on-chain payment scan (45 days, cached per wallet)
  let payments: Array<{
    txHash: string;
    product: string | null;
    amountToken: number;
    status: string;
    verifiedAt: string;
  }> = [];
  let paymentsCount = 0;
  let totalSpentPengu = 0;
  let paymentsDegraded = false;
  try {
    const found = await scanPayments(session.addr, 45);
    paymentsCount = found.length;
    totalSpentPengu = found
      .filter((p) => p.token === "PENGU")
      .reduce((a, p) => a + p.amountToken, 0);
    payments = [...found]
      .reverse()
      .slice(0, 5)
      .map((p) => ({
        txHash: p.txHash,
        product: passForAmount(p.amountToken)?.id ?? null,
        amountToken: p.amountToken,
        status: "VERIFIED",
        verifiedAt: new Date(p.blockTimestamp).toISOString(),
      }));
  } catch (err) {
    // RPC hiccup — degrade gracefully, but flag it (L9: distinguishable
    // from “scan worked, no payments”)
    log.warn("payment scan failed — dashboard degraded", { err: String(err) });
    paymentsDegraded = true;
  }

  return NextResponse.json(
    {
      ok: true,
      dashboard: {
        entitlements,
        activeGrant: active
          ? {
              product: ent!.product,
              // when the pass actually started (payment block time, not the
              // session re-mint time — honest after a restore)
              startsAt: new Date(ent!.paidAt || ent!.mintedAt).toISOString(),
              expiresAt: new Date(ent!.expiresAt).toISOString(),
              daysLeft,
              totalDays: lifetime ? LIFETIME_GRANT_DAYS : totalDays,
              progressPercent,
              lifetime,
            }
          : null,
        payments,
        memberSince: new Date(session.iat).toISOString(),
        paymentsCount,
        daysLeft,
        totalSpentPengu: Math.round(totalSpentPengu * 100) / 100,
        // true when the on-chain scan failed (empty payments ≠ zero payments)
        paymentsDegraded,
      },
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
