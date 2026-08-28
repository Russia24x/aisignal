"use client";

/**
 * Auth bridge: wallet connection (wagmi/AGW) ⇄ server session.
 *
 * Flow (popup-safe — follows the official AGW integration pattern from
 * docs.abs.xyz / build.abs.xyz, and the official SIWE component):
 *  1. `login()` opens the AGW connect popup — ALWAYS from a click handler.
 *  2. `signIn()` (also click-triggered only) fetches a server-prepared
 *     EIP-4361 SIWE message (single-use nonce, domain+chain bound), asks the
 *     wallet to sign it in the AGW popup, and posts {message, signature} to
 *     /api/auth/verify — establishing an HMAC session cookie.
 *  3. `session` exposes server-side entitlements (paid access state).
 *
 * Official reference (SIWE button):
 *   https://build.abs.xyz/docs/authentication/siwe-button
 * The server prepares the exact message (createSiweMessage from viem/siwe),
 * so this hook only relays it to the wallet — exactly like the official
 * demo's Step 2/3, minus the client-side message assembly (a hardening).
 *
 * POPUP-BLOCKER SAFETY (root-cause fix, per official docs + SDK source):
 *  - Every AGW action (connect / sign / transact) opens a 440×680 popup via
 *    plain `window.open` (`@privy-io/cross-app-connect` → `@privy-io/popup`).
 *    Browsers only honour `window.open` inside a user gesture (transient
 *    activation ≈5s). This hook therefore NEVER auto-triggers `signIn()`
 *    from an effect — the signature popup would open without a gesture and
 *    get blocked ("Failed to initialize request"). The official Abstract
 *    `agw-signing-messages` example also signs exclusively from clicks.
 *  - The privy cross-app client fetches provider details (auth.privy.io)
 *    lazily on first use; we pre-warm it on mount so the connect popup
 *    opens as fast as possible inside the click's activation window.
 *
 * `signIn()` NEVER throws: it returns `{ ok, errorCode }` with a stable
 * error code (RATE_LIMITED, SIGNATURE_REJECTED, …) that callers map to a
 * localized message. This keeps unhandled-rejection crashes out of the
 * dev overlay and gives the user actionable feedback instead.
 *
 * @module components/pengu/useAuth
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { useLoginWithAbstract } from "@abstract-foundation/agw-react";
import { createLogger } from "@/lib/client-logger";
import { authFetch, saveSessionToken, clearSessionToken } from "@/lib/client-session";
import type { EntitlementsDTO as Entitlements } from "@/lib/modules/access/passes";

const log = createLogger("auth");

export type { Entitlements };

/**
 * Stable sign-in failure codes → localized via `wallet.error.*` keys.
 *
 * POPUP_BLOCKED / TIMEOUT map the AGW cross-app-connect popup semantics:
 * the wallet UI is a 440×680 `window.open` popup that browsers may block
 * (it opens after async SDK work, so the click's user-activation can
 * expire) and that auto-closes after a 2-minute request timeout.
 * See docs/WALLET-AND-TRANSACTIONS.md § Troubleshooting.
 */
export type SignInErrorCode =
  | "RATE_LIMITED"
  | "SIGNATURE_REJECTED"
  | "POPUP_BLOCKED"
  | "TIMEOUT"
  | "SIGNATURE_FAILED"
  | "NETWORK";

export interface SignInResult {
  ok: boolean;
  errorCode?: SignInErrorCode;
}

interface SessionState {
  loading: boolean;
  entitlements: Entitlements | null;
  signingIn: boolean;
  error: string | null;
}

/** Extract a stable error code from a thrown/failed sign-in step. */
function classifyError(err: unknown, serverCode?: string): SignInErrorCode {
  const raw = String(err?.toString?.() ?? err ?? "");
  if (serverCode === "RATE_LIMITED" || raw.includes("RATE_LIMITED")) return "RATE_LIMITED";
  // wagmi wraps EIP-1193 4001 as UserRejectedRequestError; the raw AGW
  // cross-app-connect SDK throws Error("User rejected request") when the
  // user closes the popup — cover both spellings.
  if (raw.includes("UserRejected") || raw.includes("User rejected")) {
    return "SIGNATURE_REJECTED";
  }
  // AGW SDK: window.open returned null (popup blocker) — the SDK's own
  // error string is "Failed to initialize request".
  if (
    raw.includes("Failed to initialize request") ||
    raw.includes("popup") && raw.includes("blocked")
  ) {
    return "POPUP_BLOCKED";
  }
  // AGW SDK: no wallet response within TWO_MINUTES_IN_MS ("Request timeout"
  // / "Authorization request timed out after ... ms.").
  if (raw.includes("Request timeout") || raw.includes("timed out")) return "TIMEOUT";
  // Official SIWE server-side rejections (build.abs.xyz semantics):
  // malformed/expired message, wrong chain/domain, bad nonce, bad signature.
  if (
    serverCode === "INVALID_SIGNATURE" ||
    serverCode === "VERIFY_FAILED" ||
    serverCode === "BAD_SIGNATURE" ||
    serverCode === "VERIFICATION_FAILED" ||
    serverCode === "NONCE_INVALID" ||
    serverCode === "NONCE_EXPIRED" ||
    serverCode === "NONCE_REPLAY" ||
    serverCode === "NONCE_MISMATCH" ||
    serverCode === "INVALID_MESSAGE" ||
    serverCode === "BAD_ISSUED_AT" ||
    serverCode === "MESSAGE_EXPIRED" ||
    serverCode === "INVALID_CHAIN" ||
    serverCode === "INVALID_DOMAIN" ||
    raw.includes("NONCE_FAILED")
  ) {
    return "SIGNATURE_FAILED";
  }
  return "NETWORK";
}

export function useAuth() {
  const { address, status, chainId } = useAccount();
  const { login, logout: walletLogout } = useLoginWithAbstract();
  const { signMessageAsync } = useSignMessage();
  const { connectors } = useConnect();

  const [state, setState] = useState<SessionState>({
    loading: true,
    entitlements: null,
    signingIn: false,
    error: null,
  });

  /** Fetch current session state from the server (cookie OR bearer). */
  const refresh = useCallback(async (): Promise<Entitlements | null> => {
    try {
      // authFetch attaches `Authorization: Bearer` when a stored token
      // exists — the fallback that keeps sessions alive inside cross-site
      // iframe previews where browsers block our cookie.
      const res = await authFetch("/api/auth/session", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        if (process.env.NODE_ENV !== "production") {
          // mode diagnostics: "cookie" | "bearer" | null
          console.info("[auth] session mode:", data.sessionMode ?? "anonymous");
        }
        setState((s) => ({ ...s, loading: false, entitlements: data.entitlements }));
        return data.entitlements as Entitlements;
      }
    } catch {
      /* network error — keep previous state */
    }
    setState((s) => ({ ...s, loading: false }));
    return null;
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  /**
   * Pre-warm the AGW (privy cross-app) provider after mount.
   *
   * The cross-app client lazily fetches provider details from auth.privy.io
   * before it can open the connect popup. Warming it up once at mount
   * means the popup opens ~instantly when the user later clicks
   * "Connect Wallet" — comfortably inside the browser's transient-activation
   * window, which is what keeps the popup from being blocked.
   */
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current) return;
    warmed.current = true;
    void (async () => {
      try {
        const agw = connectors.find((c) => c.id === "xyz.abs.privy" || c.type === "privy");
        if (agw) await agw.getProvider(); // fires the details fetch; harmless
      } catch {
        /* pre-warm is best-effort only */
      }
    })();
  }, [connectors]);

  /**
   * Request a server message + signature + session establishment.
   * MUST be called from a click handler: the AGW signature popup is a
   * `window.open`, which browsers only allow inside a user gesture.
   * Never throws — inspect the returned result instead.
   */
  const signIn = useCallback(
    async (): Promise<SignInResult> => {
      if (!address) return { ok: false, errorCode: "NETWORK" };
      setState((s) => ({ ...s, signingIn: true, error: null }));
      const fail = (code: SignInErrorCode): SignInResult => {
        log.warn("sign-in failed", { code });
        setState((s) => ({ ...s, signingIn: false, error: code }));
        return { ok: false, errorCode: code };
      };
      try {
        // Step 1 (official SIWE flow): fetch a server-prepared EIP-4361
        // message bound to a single-use nonce, our domain and our chain.
        const nonceRes = await fetch(`/api/auth/nonce?address=${address}`);
        const nonceData = await nonceRes.json();
        if (!nonceData.ok) return fail(classifyError(null, nonceData.error ?? "NONCE_FAILED"));
        log.debug("nonce issued, requesting wallet signature…");

        // Step 2: sign the exact server-controlled message (click gesture).
        let signature: string;
        try {
          signature = await signMessageAsync({ message: nonceData.message });
        } catch (sigErr) {
          return fail(classifyError(sigErr));
        }
        log.debug("signature received, verifying server-side…");

        // Step 3 (official shape): POST { message, signature } for
        // parseSiweMessage + verifySiweMessage (EIP-1271 aware) server-side.
        const verifyRes = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: nonceData.message, signature }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.ok) return fail(classifyError(null, verifyData.error ?? "VERIFY_FAILED"));

        // Step 4: keep the signed session token for cookie-blocked contexts
        // (cross-site iframe previews) — authFetch sends it as Bearer.
        if (verifyData.sessionToken) saveSessionToken(verifyData.sessionToken);
        log.debug("verified — refreshing entitlements…");

        const ent = await refresh();
        if (!ent?.authenticated) {
          // Extremely unlikely (both cookie AND bearer failed) — clear the
          // stored token so the next attempt starts clean.
          clearSessionToken();
          return fail("NETWORK");
        }
        setState((s) => ({ ...s, signingIn: false, error: null }));
        return { ok: true };
      } catch (err) {
        return fail(classifyError(err));
      }
    },
    [address, signMessageAsync, refresh],
  );

  // NOTE: no automatic sign-in effect here. Opening the AGW signature
  // popup without a user gesture is exactly what gets it blocked by
  // browsers (official AGW examples sign from explicit clicks only).
  // The Header / SignalSection CTAs cover the connected-but-signed-out
  // state — `needsSignIn` below tells the UI when to highlight them.

  /** Full logout: server session + stored token + wallet disconnect. */
  const signOut = useCallback(async () => {
    await authFetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    clearSessionToken();
    setState({ loading: false, entitlements: null, signingIn: false, error: null });
    await refresh();
    walletLogout();
  }, [refresh, walletLogout]);

  /** true when the wallet is connected but the server session is missing —
   *  the UI uses this to highlight the (click-triggered) sign-in CTA. */
  const needsSignIn =
    status === "connected" && !!address && !state.loading && !state.entitlements?.authenticated;

  return {
    address,
    walletStatus: status,
    chainId,
    ...state,
    needsSignIn,
    login,
    signIn,
    signOut,
    refresh,
  };
}
