/**
 * GET /api/auth/nonce?address=0x...
 * Issues a single-use official-format nonce (`viem/siwe` generateSiweNonce)
 * AND the exact EIP-4361 message the wallet must sign (built server-side
 * with `createSiweMessage` — domain/URI/chainId/expiry are server-controlled,
 * so the client cannot tamper with what it signs).
 *
 * Official reference: https://build.abs.xyz/docs/authentication/siwe-button
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { issueNonce, isValidAddress, buildAuthMessage, MESSAGE_TTL_MS } from "@/lib/security/siwe";

export async function GET(req: NextRequest) {
  const limited = guard(req, "auth");
  if (limited) return limited;

  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!address || !isValidAddress(address)) {
    return NextResponse.json({ ok: false, error: "INVALID_ADDRESS" }, { status: 400 });
  }

  const { nonce } = issueNonce(address);
  const issuedAt = new Date();
  const message = buildAuthMessage({ address, nonce, issuedAt });

  return NextResponse.json(
    {
      ok: true,
      nonce,
      message,
      issuedAt: issuedAt.toISOString(),
      expiresInMs: MESSAGE_TTL_MS,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}
