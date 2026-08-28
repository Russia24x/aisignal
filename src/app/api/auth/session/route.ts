/**
 * GET  /api/auth/session — current session + entitlements (+ delivery mode)
 * DELETE /api/auth/session — logout
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSessionMode, destroySession } from "@/lib/security/session";
import { getEntitlements } from "@/lib/modules/access/entitlements";

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  const { session, mode } = await getSessionMode();
  const entitlements = await getEntitlements(session?.sub ?? null);
  // `sessionMode` tells the client (and QA) whether the session arrived via
  // cookie or via the Bearer fallback — invaluable when debugging embedded
  // (iframe) previews where cookies are blocked.
  return NextResponse.json({ ok: true, entitlements, sessionMode: mode });
}

export async function DELETE(req: NextRequest) {
  const limited = guard(req, "auth");
  if (limited) return limited;
  await destroySession();
  return NextResponse.json({ ok: true });
}
