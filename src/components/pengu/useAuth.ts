"use client";

/**
 * Auth bridge: wallet connection (wagmi/AGW) ⇄ server session.
 *
 * ⚠️ ARCHITECTURE (fixed the "sections don't sync until refresh" bug):
 * `useAuth()` does NOT own state anymore. It reads the SINGLE shared
 * instance maintained by <AuthProvider> (components/pengu/AuthProvider.tsx,
 * mounted once in Providers inside AbstractWalletProvider). Previously every
 * component instantiated its own entitlements snapshot: signing in via the
 * Header updated only the Header, every other section kept the stale
 * anonymous state, and only a full page reload re-synced them. With the
 * shared context one signIn()/refresh()/payment updates ALL sections in the
 * same render pass.
 *
 * Flow (popup-safe — follows the official AGW integration pattern from
 * docs.abs.xyz / build.abs.xyz, and the official SIWE component):
 *  1. `login()` opens the AGW connect popup — ALWAYS from a click handler.
 *     The returned promise is OWNED by the provider: every failure surfaces
 *     as a localized toast (previously connect failures were completely
 *     silent — "nothing happens").
 *  2. `signIn()` (also click-triggered only) fetches a server-prepared
 *     EIP-4361 SIWE message (single-use nonce, domain+chain bound), asks the
 *     wallet to sign it in the AGW popup, and posts {message, signature} to
 *     /api/auth/verify — establishing an HMAC session (cookie + bearer
 *     token for iframe contexts).
 *  3. `session` exposes server-side entitlements (paid access state) —
 *     SHARED across every section.
 *
 * Official reference (SIWE button):
 *   https://build.abs.xyz/docs/authentication/siwe-button
 *
 * POPUP-BLOCKER SAFETY (root-cause fix, per official docs + SDK source):
 *  - Every AGW action (connect / sign / transact) opens a 440×680 popup via
 *    plain `window.open` (`@privy-io/cross-app-connect` → `@privy-io/popup`).
 *    Browsers only honour `window.open` inside a user gesture (transient
 *    activation ≈5s). This hook therefore NEVER auto-triggers `signIn()`
 *    from an effect — the signature popup would open without a gesture and
 *    get blocked ("Failed to initialize request"). The official Abstract
 *    `agw-signing-messages` example also signs exclusively from clicks.
 *
 * LIVE-STATE SYNC (lib/agw-bridge): the popup delivers the wallet connection
 * back via window.postMessage. If that live path breaks (flaky network to
 * the privy/abs domains, lost message, …) the bridge's connection watcher
 * polls the persisted connection after every `login()` and force-syncs
 * wagmi the moment it appears — the reload's job, done live. On top of that,
 * the session is re-fetched on every account change by the shared provider,
 * so all section gates flip live.
 *
 * `signIn()` NEVER throws: it returns `{ ok, errorCode }` with a stable
 * error code (RATE_LIMITED, SIGNATURE_REJECTED, …). Failures ALSO toast a
 * localized message in the provider (single source — callers must not
 * double-toast).
 *
 * @module components/pengu/useAuth
 */
import { useAuthContext } from "./AuthProvider";

export type {
  Entitlements,
  SignInErrorCode,
  SignInResult,
  AuthApi,
} from "./AuthProvider";

/**
 * Read the app-wide auth/session state. One shared instance behind
 * <AuthProvider> — every consumer sees the same entitlements, so a sign-in
 * (or payment) anywhere updates every section without a reload.
 */
export function useAuth() {
  return useAuthContext();
}
