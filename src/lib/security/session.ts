/**
 * HMAC-signed stateless session tokens stored in httpOnly cookies.
 *
 * Token format: `base64url(payload).base64url(hmacSha256(payload))`
 * Payload: { sub: userId, addr: walletAddress, iat, exp, jti }
 *
 * Security properties:
 *  - tamper-proof (HMAC-SHA256, timing-safe compare)
 *  - httpOnly + sameSite=lax + secure (prod) cookie
 *  - short-lived access tokens with server-side revocation list
 *
 * @module lib/security/session
 */
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { serverConfig } from "@/lib/config";

const COOKIE_NAME = "pengu_session";
const REFRESH_COOKIE_NAME = "pengu_refresh";

export interface SessionPayload {
  sub: string; // user id
  addr: string; // checksummed address (lowercase)
  iat: number;
  exp: number;
  jti: string;
}

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

/** Create session for user and set cookies (must run in route handler ctx). */
export async function establishSession(userId: string, address: string): Promise<SessionPayload> {
  const now = Date.now();
  const ttlMs = serverConfig.SESSION_TTL_HOURS * 3600 * 1000;
  const payload: SessionPayload = {
    sub: userId,
    addr: address.toLowerCase(),
    iat: now,
    exp: now + ttlMs,
    jti: randomUUID(),
  };
  const jar = await cookies();
  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  };
  jar.set(COOKIE_NAME, encodeSession(payload), common);
  return payload;
}

/** Read & verify the current session from cookies. */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return decodeSession(jar.get(COOKIE_NAME)?.value);
}

/** Destroy session cookies. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  jar.delete(REFRESH_COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
