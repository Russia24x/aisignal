/**
 * POST /api/auth/verify
 * Body: { message, signature }  — official SIWE shape
 *   (https://build.abs.xyz/docs/authentication/siwe-button)
 *
 * Verifies the EIP-4361 message + wallet signature (EOA or EIP-1271 smart
 * wallet like AGW) via the official `verifySiweMessage` chain, creates the
 * user if needed, establishes the session.
 *
 * Response includes the signed session TOKEN alongside the httpOnly cookie:
 * cookie-blocked contexts (cross-site iframe previews) keep it in
 * localStorage and send it as `Authorization: Bearer` — see
 * lib/client-session.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/security/rate-limit";
import { verifyAuth } from "@/lib/security/siwe";
import { establishSession } from "@/lib/security/session";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:verify");

const bodySchema = z.object({
  message: z.string().min(50).max(4096),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/).min(4),
});

export async function POST(req: NextRequest) {
  const limited = guard(req, "auth");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues.length }, { status: 400 });
  }

  const result = await verifyAuth({
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
    requestHost: req.headers.get("host"),
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  }

  const address = result.address!;
  const user = await db.user.upsert({
    where: { address },
    update: { loginCount: { increment: 1 }, lastLoginAt: new Date() },
    create: { address },
  });

  const { token } = await establishSession(user.id, address);
  log.info("user authenticated", { userId: user.id, address });

  return NextResponse.json({
    ok: true,
    user: { id: user.id, address },
    // Same signed token as the httpOnly cookie — for iframe-embedded
    // clients where cookies are blocked (standard SIWE+token pattern).
    sessionToken: token,
  });
}
