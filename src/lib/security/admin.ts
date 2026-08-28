/**
 * Admin (owner) authorization — the single source of truth for "is this
 * wallet a platform owner?".
 *
 * Owners are configured via the `ADMIN_ADDRESSES` env var (comma-separated
 * lowercase addresses). When unset/empty, admin features are fully disabled:
 * every admin API route 403s and the admin panel never renders.
 *
 * Checks are O(1) Set lookups against a normalized (lowercase) address —
 * no DB roundtrip needed, works statelessly from the signed session payload.
 *
 * @module lib/security/admin
 */
import { serverConfig } from "@/lib/config";
import type { SessionPayload } from "@/lib/security/session";

/** Normalize any address spelling to the canonical lowercase form. */
export function normalizeAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const a = addr.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(a) ? a : null;
}

/** Is this address a configured admin? */
export function isAdminAddress(addr: string | null | undefined): boolean {
  const a = normalizeAddress(addr);
  if (!a || serverConfig.adminAddresses.size === 0) return false;
  return serverConfig.adminAddresses.has(a);
}

/** Is this authenticated session an admin session? */
export function isAdminSession(session: SessionPayload | null): boolean {
  if (!session) return false;
  return isAdminAddress(session.addr);
}
