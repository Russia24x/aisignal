"use client";

/**
 * Auth bridge: wallet connection (wagmi/AGW) ⇄ server session.
 *
 * Flow:
 *  1. `login()` opens the AGW modal (useLoginWithAbstract)
 *  2. once a wallet is connected, `signIn()` fetches a server-prepared
 *     message (nonce-bound), asks the wallet to sign it, and posts the
 *     signature to /api/auth/verify — establishing an HMAC session cookie
 *  3. `session` exposes server-side entitlements (paid access state)
 *
 * `signIn()` NEVER throws: it returns `{ ok, errorCode }` with a stable
 * error code (RATE_LIMITED, SIGNATURE_REJECTED, …) that callers map to a
 * localized message. This keeps unhandled-rejection crashes out of the
 * dev overlay and gives the user actionable feedback instead.
 *
 * @module components/pengu/useAuth
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useLoginWithAbstract } from "@abstract-foundation/agw-react";
import { createLogger } from "@/lib/client-logger";
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
  if (
    serverCode === "INVALID_SIGNATURE" ||
    serverCode === "VERIFY_FAILED" ||
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

  const [state, setState] = useState<SessionState>({
    loading: true,
    entitlements: null,
    signingIn: false,
    error: null,
  });
  const triedAutoSignIn = useRef<string | null>(null);

  /** Fetch current session state from the server. */
  const refresh = useCallback(async (): Promise<Entitlements | null> => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
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
   * Request a server message + signature + session establishment.
   * Never throws — inspect the returned result instead.
   */
  const signIn = useCallback(
    async (silent = false): Promise<SignInResult> => {
      if (!address) return { ok: false, errorCode: "NETWORK" };
      setState((s) => ({ ...s, signingIn: true, error: null }));
      const fail = (code: SignInErrorCode): SignInResult => {
        log.warn("sign-in failed", { code });
        setState((s) => ({ ...s, signingIn: false, error: code }));
        return { ok: false, errorCode: code };
      };
      try {
        const nonceRes = await fetch(`/api/auth/nonce?address=${address}`);
        const nonceData = await nonceRes.json();
        if (!nonceData.ok) return fail(classifyError(null, nonceData.error ?? "NONCE_FAILED"));

        let signature: string;
        try {
          signature = await signMessageAsync({ message: nonceData.message });
        } catch (sigErr) {
          return fail(classifyError(sigErr));
        }

        const verifyRes = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address,
            nonce: nonceData.nonce,
            issuedAt: nonceData.issuedAt,
            signature,
          }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.ok) return fail(classifyError(null, verifyData.error ?? "VERIFY_FAILED"));

        await refresh();
        setState((s) => ({ ...s, signingIn: false, error: null }));
        return { ok: true };
      } catch (err) {
        return fail(classifyError(err));
      }
    },
    [address, signMessageAsync, refresh],
  );

  // auto sign-in once per connected address (seamless UX)
  useEffect(() => {
    if (status === "connected" && address && !state.entitlements?.authenticated && !state.signingIn) {
      if (triedAutoSignIn.current !== address) {
        triedAutoSignIn.current = address;
        void (async () => {
          await signIn(true);
        })();
      }
    }
  }, [status, address, state.entitlements?.authenticated, state.signingIn, signIn]);

  /** Full logout: server session + wallet disconnect. */
  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    triedAutoSignIn.current = null;
    setState({ loading: false, entitlements: null, signingIn: false, error: null });
    await refresh();
    walletLogout();
  }, [refresh, walletLogout]);

  return {
    address,
    walletStatus: status,
    chainId,
    ...state,
    login,
    signIn,
    signOut,
    refresh,
  };
}
