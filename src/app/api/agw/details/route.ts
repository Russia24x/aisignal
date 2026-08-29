/**
 * GET /api/agw/details
 *
 * Same-origin proxy for the AGW (privy cross-app) provider-details document.
 *
 * WHY THIS EXISTS: the AGW SDK must fetch this tiny PUBLIC json from
 * `auth.privy.io` before it can open any wallet popup (connect / sign /
 * transact). On filtered networks (e.g. Iran) that domain is frequently
 * unreachable — which used to silently kill the connect button AND the
 * whole purchase flow (sign + tx popups could never open). Serving the
 * document from our own origin removes privy.io from the client's critical
 * path: the browser only needs our app + portal.abs.xyz (Abstract's own
 * domain) + the RPC.
 *
 * Resolution order:
 *  1. in-memory cache (1h TTL) — the doc is public + stable
 *  2. upstream auth.privy.io (5s timeout, server-side egress)
 *  3. bundled constants (verified public values — see lib/agw-details)
 *
 * The data is public by classification (`data_classification: "public"`);
 * no secrets are involved.
 *
 * @module app/api/agw/details
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/security/rate-limit";
import {
  AGW_DETAILS_FALLBACK,
  AGW_DETAILS_URL,
  looksLikeAgwDetails,
  type AgwProviderDetails,
} from "@/lib/agw-details";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const UPSTREAM_TIMEOUT_MS = 5_000;

let cache: { json: AgwProviderDetails; at: number } | null = null;

function respond(json: AgwProviderDetails, source: "cache" | "upstream" | "fallback") {
  // NOTE: the `source` is intentionally NOT exposed as a response header —
  // it reveals server-side network reachability (ops info) to outsiders;
  // it is only logged server-side.
  void source;
  return NextResponse.json(json, {
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

export async function GET(_req: NextRequest) {
  // Cheap abuse guard (this is public static-ish data; one call per page load).
  const limited = rateLimit("agw-details", clientIp(_req), 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return respond(cache.json, "cache");
  }

  try {
    const res = await fetch(AGW_DETAILS_URL, {
      method: "GET",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) {
      const json: unknown = await res.json();
      if (looksLikeAgwDetails(json)) {
        cache = { json, at: now };
        return respond(json, "upstream");
      }
    }
  } catch {
    /* upstream unreachable / slow / malformed — fall through */
  }

  // Upstream failed (filtered network or outage): serve the verified public
  // constants so clients keep working. Do NOT cache failures for the full TTL
  // — allow the next request to retry upstream.
  return respond(AGW_DETAILS_FALLBACK, "fallback");
}
