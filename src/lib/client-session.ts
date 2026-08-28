"use client";

/**
 * Client-side session token store + authenticated fetch wrapper.
 *
 * WHY: the app can be embedded in a cross-site iframe (preview panels),
 * where browsers block our httpOnly session cookie (SameSite rules /
 * third-party cookie blocking). On successful SIWE verify the server
 * returns the SAME HMAC-signed token it put in the cookie; we keep it in
 * localStorage and attach it as `Authorization: Bearer <token>` on every
 * session-gated API call. Top-level browsers keep using the cookie — the
 * header is only sent when we actually hold a token.
 *
 * Security notes:
 *  - the token is the identical HMAC-signed value the server verifies for
 *    cookies — no separate/weaker credential is ever accepted
 *  - logout clears it; TTL is enforced server-side (signed exp claim)
 *
 * @module lib/client-session
 */
const TOKEN_KEY = "pengu_session_token";

export function saveSessionToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable (private mode) — cookie path still applies */
  }
}

export function getSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
}

/**
 * fetch() that transparently authenticates: cookies are always sent
 * (same-origin), plus the Bearer header whenever a stored token exists.
 */
export async function authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = getSessionToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
