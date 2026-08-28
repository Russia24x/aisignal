/**
 * Sliding-window in-memory rate limiter.
 * Keyed by `${bucket}:${ip}`. Suitable for single-instance / per-isolate use;
 * for multi-instance deployments swap with Cloudflare Rate Limiting binding
 * (see docs/DEPLOYMENT.md).
 *
 * @module lib/security/rate-limit
 */
import { NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";

interface Window {
  hits: number[];
}

const buckets = new Map<string, Window>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(bucket: string, key: string, limit: number, windowMs: number): RateLimitResult {
  const id = `${bucket}:${key}`;
  const now = Date.now();
  let w = buckets.get(id);
  if (!w) {
    w = { hits: [] };
    buckets.set(id, w);
  }
  // prune expired hits
  w.hits = w.hits.filter((t) => now - t < windowMs);
  if (w.hits.length >= limit) {
    const oldest = w.hits[0];
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
  }
  w.hits.push(now);
  // periodic cleanup to bound memory
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return { ok: true, remaining: limit - w.hits.length, retryAfterMs: 0 };
}

/** Extract client IP from proxy headers (Cloudflare / Caddy aware). */
export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Standard guard used by API routes. Returns a 429 Response when limited. */
export function guard(req: NextRequest, bucket: keyof typeof serverConfig.rateLimits): Response | null {
  const { limit, windowMs } = serverConfig.rateLimits[bucket];
  const res = rateLimit(bucket, clientIp(req), limit, windowMs);
  if (!res.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: "RATE_LIMITED", retryAfterMs: res.retryAfterMs }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(Math.ceil(res.retryAfterMs / 1000)),
        },
      },
    );
  }
  return null;
}
