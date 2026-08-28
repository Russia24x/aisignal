/**
 * DELETE /api/alerts/[id] — delete a price alert.
 *
 * Auth required and the alert must belong to the caller (no cross-user
 * deletion). Returns 404 if the alert id is unknown OR belongs to a
 * different user — both cases are indistinguishable from the caller's POV
 * so we avoid leaking existence.
 *
 * @module app/api/alerts/[id]
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = guard(req, "payment");
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "INVALID_ID" }, { status: 422 });
  }

  // ownership-scoped delete — only deletes if userId matches session.sub
  const result = await db.priceAlert.deleteMany({
    where: { id, userId: session.sub },
  });

  if (result.count === 0) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
