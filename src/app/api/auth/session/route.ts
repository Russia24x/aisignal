/**
 * GET  /api/auth/session — current session + entitlements
 * DELETE /api/auth/session — logout
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession, destroySession } from "@/lib/security/session";
import { getEntitlements } from "@/lib/modules/access/entitlements";

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  const session = await getSession();
  const entitlements = await getEntitlements(session?.sub ?? null);
  return NextResponse.json({ ok: true, entitlements });
}

export async function DELETE(req: NextRequest) {
  const limited = guard(req, "auth");
  if (limited) return limited;
  await destroySession();
  return NextResponse.json({ ok: true });
}
