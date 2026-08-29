/**
 * POST /api/payment/verify
 * Body: { txHash, product, quote? }
 *
 * Verifies the payment fully server-side against the Abstract RPC and mints
 * the entitlement INTO the session (stateless v4 — nothing is stored).
 * Products are access passes defined in lib/modules/access/passes.ts.
 * For non-PENGU tokens (e.g. native ETH) the signed quote from
 * /api/payment/config must accompany the request. See
 * lib/modules/access/payments.ts for the trust model.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/security/rate-limit";
import { getSession, mintEntitlement } from "@/lib/security/session";
import { verifyPayment, type SignedQuote } from "@/lib/modules/access/payments";
import { productCatalog, entitlementsFromSession, currentClaim } from "@/lib/modules/access/entitlements";
import { createLogger } from "@/lib/logger";

const log = createLogger("payment:verify");

const quoteSchema = z.object({
  product: z.string(),
  token: z.string(),
  amountToken: z.number().positive(),
  quotedAt: z.number(),
  sig: z.string(),
}) as z.ZodType<SignedQuote>;

const bodySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash"),
  product: z.string().regex(/^[A-Z0-9_]{2,32}$/),
  quote: quoteSchema.optional(),
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

  const { txHash, product, quote } = parsed.data;
  const catalog = productCatalog();
  const prod = catalog[product];
  if (!prod) {
    return NextResponse.json({ ok: false, error: "UNKNOWN_PRODUCT" }, { status: 400 });
  }

  try {
    // stacking: a new pass extends the current entitlement when still active
    const current = currentClaim(session);
    const currentExpiry =
      current && (current.lifetime || current.expiresAt > Date.now())
        ? current.expiresAt
        : undefined;

    const result = await verifyPayment({
      txHash,
      userAddress: session.addr,
      product,
      quote,
      currentExpiry,
    });
    if (!result.ok) {
      const status =
        result.error === "TX_NOT_FOUND" ? 404 : result.error === "TX_PENDING" ? 202 : 400;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }

    // mint the entitlement into a fresh signed session
    const minted = await mintEntitlement({
      product: result.entitlement!.product,
      expiresAt: result.entitlement!.expiresAt,
      lifetime: result.entitlement!.lifetime,
      txHash: result.entitlement!.txHash,
      mintedAt: Date.now(),
    });
    if (!minted) {
      return NextResponse.json({ ok: false, error: "SESSION_MINT_FAILED" }, { status: 500 });
    }

    const entitlements = entitlementsFromSession(minted.payload);
    return NextResponse.json({
      ok: true,
      amountToken: result.amountToken,
      token: result.token,
      entitlements,
      // fresh bearer token (iframe contexts keep localStorage in sync)
      sessionToken: minted.token,
    });
  } catch (err) {
    log.error("payment verification failed", { err: String(err) });
    return NextResponse.json({ ok: false, error: "VERIFICATION_ERROR" }, { status: 500 });
  }
}
