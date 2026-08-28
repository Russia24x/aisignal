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
 * @module components/pengu/useAuth
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useLoginWithAbstract } from "@abstract-foundation/agw-react";
import { createLogger } from "@/lib/client-logger";

const log = createLogger("auth");

export interface Entitlements {
  authenticated: boolean;
  address: string | null;
  platformAccess: boolean;
  signalAccess: boolean;
  activeGrant: { product: "DAY_PASS" | "SUBSCRIPTION"; expiresAt: string } | null;
  subscriptionDaysLeft: number;
}

interface SessionState {
  loading: boolean;
  entitlements: Entitlements | null;
  signingIn: boolean;
  error: string | null;
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
    refresh();
  }, [refresh]);

  /** Request a server message + signature + session establishment. */
  const signIn = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!address) return false;
      setState((s) => ({ ...s, signingIn: true, error: null }));
      try {
        const nonceRes = await fetch(`/api/auth/nonce?address=${address}`);
        const nonceData = await nonceRes.json();
        if (!nonceData.ok) throw new Error(nonceData.error ?? "NONCE_FAILED");

        const signature = await signMessageAsync({ message: nonceData.message });

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
        if (!verifyData.ok) throw new Error(verifyData.error ?? "VERIFY_FAILED");

        await refresh();
        setState((s) => ({ ...s, signingIn: false }));
        return true;
      } catch (err) {
        log.warn("sign-in failed", { err: String(err) });
        setState((s) => ({ ...s, signingIn: false, error: String(err) }));
        if (!silent) throw err;
        return false;
      }
    },
    [address, signMessageAsync, refresh],
  );

  // auto sign-in once per connected address (seamless UX)
  useEffect(() => {
    if (status === "connected" && address && !state.entitlements?.authenticated && !state.signingIn) {
      if (triedAutoSignIn.current !== address) {
        triedAutoSignIn.current = address;
        signIn(true).catch(() => undefined);
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
