/**
 * POST /api/auth/verify
 * Body: { address, nonce, issuedAt, signature }
 * Verifies the wallet signature (EOA or EIP-1271 smart wallet like AGW),
 * creates the user if needed, establishes an HMAC session cookie.
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
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.string().min(16).max(128),
  issuedAt: z.string(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
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
    address: parsed.data.address,
    nonce: parsed.data.nonce,
    issuedAt: parsed.data.issuedAt,
    signature: parsed.data.signature as `0x${string}`,
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

  await establishSession(user.id, address);
  log.info("user authenticated", { userId: user.id, address });

  return NextResponse.json({
    ok: true,
    user: { id: user.id, address },
  });
}
