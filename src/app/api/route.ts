import { NextResponse } from "next/server";

/** GET /api — health & version probe. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "pengu-signals",
    time: new Date().toISOString(),
  });
}
