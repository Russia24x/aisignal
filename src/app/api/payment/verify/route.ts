/**
 * POST /api/payment/verify
 * Body: { txHash, product }
 *
 * Verifies the payment fully server-side against the Abstract RPC and
 * credits the authenticated user. See lib/modules/access/payments.ts
 * for the trust model.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { verifyAndCredit } from "@/lib/modules/access/payments";
import { productCatalog, getEntitlements } from "@/lib/modules/access/entitlements";
import { createLogger } from "@/lib/logger";

const log = createLogger("payment:verify");

const bodySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash"),
  product: z.enum(["PLATFORM_ACCESS", "DAY_PASS", "SUB_7", "SUB_30"]).or(z.string().regex(/^[A-Z0-9_]{2,32}$/)),
});

export async function POST(req: NextRequest) {
  const limited = guard(req, "payment");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const { txHash, product } = parsed.data;
  const catalog = productCatalog();
  const prod = catalog[product];
  if (!prod) {
    return NextResponse.json({ ok: false, error: "UNKNOWN_PRODUCT" }, { status: 400 });
  }

  try {
    const result = await verifyAndCredit({
      txHash,
      userAddress: session.addr,
      product,
      expectedPrice: prod.pricePengu,
    });
    if (!result.ok) {
      const status = result.error === "TX_NOT_FOUND" ? 404 : result.error === "TX_PENDING" ? 202 : 400;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }
    const entitlements = await getEntitlements(session.sub);
    return NextResponse.json({ ok: true, amountToken: result.amountToken, entitlements });
  } catch (err) {
    log.error("payment verification failed", { err: String(err) });
    return NextResponse.json({ ok: false, error: "VERIFICATION_ERROR" }, { status: 500 });
  }
}
