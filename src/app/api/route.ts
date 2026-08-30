import { NextResponse } from "next/server";
import { isSessionSecretConfigured } from "@/lib/config";

/**
 * GET /api — health & version probe.
 *
 * `sessionConfigured` tells the operator (without leaking anything) whether
 * the runtime SESSION_SECRET is present — the one value that cannot be baked
 * into the build and must be set via `wrangler secret put SESSION_SECRET`.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "pengu-signals",
    sessionConfigured: isSessionSecretConfigured(),
    time: new Date().toISOString(),
  });
}
