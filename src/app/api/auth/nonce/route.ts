/**
 * GET /api/auth/nonce?address=0x...
 * Issues a single-use nonce AND the exact message the wallet must sign.
 * The server controls the full message (domain binding, timestamp) — the
 * client only relays it to the wallet for signature.
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { issueNonce, isValidAddress, buildAuthMessage } from "@/lib/security/siwe";

export async function GET(req: NextRequest) {
  const limited = guard(req, "auth");
  if (limited) return limited;

  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!address || !isValidAddress(address)) {
    return NextResponse.json({ ok: false, error: "INVALID_ADDRESS" }, { status: 400 });
  }

  const { nonce } = await issueNonce(address);
  const issuedAt = new Date().toISOString();
  const message = buildAuthMessage({ address, nonce, issuedAt });

  return NextResponse.json({
    ok: true,
    nonce,
    message,
    issuedAt,
    expiresInMs: 5 * 60 * 1000,
  });
}
