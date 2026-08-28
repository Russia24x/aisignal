/**
 * HMAC-signed stateless session tokens — DUAL-MODE delivery:
 *
 *   1. httpOnly cookie (preferred, works top-level) — SameSite adapts to
 *      the request protocol: `None; Secure` over HTTPS so the cookie also
 *      survives cross-site iframe embeds (preview panels) on Chrome/Firefox.
 *   2. `Authorization: Bearer <token>` header (fallback) — the SAME signed
 *      token returned in the verify response and kept in localStorage.
 *      Browsers that block third-party cookies entirely (Safari, Chrome
 *      3P phase-out) still get a working session inside iframes.
 *
 * Token format: `base64url(payload).base64url(hmacSha256(payload))`
 * Payload: { sub: userId, addr: walletAddress, iat, exp, jti }
 *
 * Security properties:
 *  - tamper-proof (HMAC-SHA256, timing-safe compare)
 *  - identical verification for both delivery modes
 *  - bearer tokens are opt-in client-side (localStorage) — the standard
 *    SIWE+JWT pattern for iframe-embedded dapps
 *
 * @module lib/security/session
 */
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { serverConfig } from "@/lib/config";

const COOKIE_NAME = "pengu_session";
const REFRESH_COOKIE_NAME = "pengu_refresh";

export interface SessionPayload {
  sub: string; // user id
  addr: string; // wallet address (lowercase)
  iat: number;
  exp: number;
  jti: string;
}

/** Which delivery mode produced the current session (diagnostics). */
export type SessionMode = "cookie" | "bearer";

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", serverConfig.SESSION_SECRET).update(data).digest("base64url");
}

export function encodeSession(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(body);
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (!payload.sub || !payload.addr) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Extract a Bearer token from the Authorization header (if any). */
async function bearerToken(): Promise<string | null> {
  const h = await headers();
  const auth = h.get("authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

/**
 * Create a session for the user: sets the adaptive cookie AND returns the
 * signed token so the route can hand it to clients running in cookie-
 * blocked contexts (cross-site iframes).
 *
 * Cookie attributes:
 *  - HTTPS (x-forwarded-proto from the gateway or next-url): SameSite=None
 *    + Secure — required for the cookie to be stored/sent inside a
 *    cross-site iframe on Chrome/Firefox.
 *  - plain HTTP dev (localhost): SameSite=Lax, Secure off.
 */
export async function establishSession(
  userId: string,
  address: string,
): Promise<{ payload: SessionPayload; token: string }> {
  const now = Date.now();
  const ttlMs = serverConfig.SESSION_TTL_HOURS * 3600 * 1000;
  const payload: SessionPayload = {
    sub: userId,
    addr: address.toLowerCase(),
    iat: now,
    exp: now + ttlMs,
    jti: randomUUID(),
  };
  const token = encodeSession(payload);

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const isHttps = proto.split(",")[0].trim() === "https";

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    // SameSite=None REQUIRES Secure and is the only value browsers accept
    // for cookies used inside cross-site iframes.
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps,
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
  return { payload, token };
}

/**
 * Read & verify the current session: cookie first, Bearer header second.
 * Both modes run the exact same HMAC verification — no weaker path.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const fromCookie = decodeSession(jar.get(COOKIE_NAME)?.value);
  if (fromCookie) return fromCookie;
  return decodeSession(await bearerToken());
}

/** Same as getSession but also reports the delivery mode (diagnostics). */
export async function getSessionMode(): Promise<{ session: SessionPayload | null; mode: SessionMode | null }> {
  const jar = await cookies();
  if (decodeSession(jar.get(COOKIE_NAME)?.value)) {
    return { session: decodeSession(jar.get(COOKIE_NAME)?.value), mode: "cookie" };
  }
  const token = await bearerToken();
  const session = decodeSession(token);
  return { session, mode: session ? "bearer" : null };
}

/** Destroy session cookies (bearer tokens are cleared client-side). */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  jar.delete(REFRESH_COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
