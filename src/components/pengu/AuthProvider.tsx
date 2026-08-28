"use client";

/**
 * AuthProvider — SINGLE SHARED SOURCE OF TRUTH for the auth/session state.
 *
 * WHY THIS EXISTS (root cause of "sections don't sync until I refresh"):
 * `useAuth` used to be a plain hook, so EVERY component (Header,
 * PricingSection, SignalSection ×2, PriceAlerts, MyDashboard, PaymentDialog —
 * 8 call sites) instantiated its OWN copy of the session state. Consequences:
 *  - Header's "sign in" succeeded → ONLY the Header's entitlements updated;
 *    every other section kept its pre-sign-in anonymous snapshot and still
 *    rendered the "sign the login message" gate → user reloads the page →
 *    the on-mount session fetch (cookie/bearer) finally flips them
 *    ("refresh fixes it" — the exact user report);
 *  - a payment verified in PaymentDialog refreshed only the dialog's own
 *    copy — the pricing grid kept stale "choose plan" buttons;
 *  - after a wallet-connect via the Header, the entitlements refetch
 *    happened 8 times in parallel (once per instance).
 *
 * HOW IT WORKS NOW:
 *  - Providers.tsx mounts <AuthProvider> ONCE inside AbstractWalletProvider
 *    (it needs wagmi's context). The whole former hook body lives HERE, in a
 *    single instance.
 *  - `useAuth()` (./useAuth) is now just `useContext(AuthContext)` — all 8
 *    consumers read the SAME state object. One signIn/refresh/payment
 *    updates every section in the same render pass. No reload needed. Ever.
 *
 * The hook's behavioral contract (owned promises, click-gesture-only AGW
 * actions, centralized toasts, bridge watcher arming, bearer-token session
 * fallback) is unchanged — see the detailed docs previously living on the
 * hook, preserved in ./useAuth.ts.
 *
 * @module components/pengu/AuthProvider
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { toast } from "sonner";
import { createLogger } from "@/lib/client-logger";
import { armConnectionWatch } from "@/lib/agw-bridge";
import { useI18n } from "@/components/i18n/I18nProvider";
import { authFetch, saveSessionToken, clearSessionToken } from "@/lib/client-session";
import type { EntitlementsDTO as Entitlements } from "@/lib/modules/access/passes";

const log = createLogger("auth");

export type { Entitlements };

export type SignInErrorCode =
  | "RATE_LIMITED"
  | "SIGNATURE_REJECTED"
  | "POPUP_BLOCKED"
  | "TIMEOUT"
  | "SIGNATURE_FAILED"
  | "NETWORK"
  | "CONNECTOR_MISSING";

export interface SignInResult {
  ok: boolean;
  errorCode?: SignInErrorCode;
}

export interface AuthApi {
  address: ReturnType<typeof useAccount>["address"];
  walletStatus: ReturnType<typeof useAccount>["status"];
  chainId: ReturnType<typeof useAccount>["chainId"];
  loading: boolean;
  entitlements: Entitlements | null;
  signingIn: boolean;
  error: string | null;
  needsSignIn: boolean;
  login: () => Promise<void>;
  signIn: () => Promise<SignInResult>;
  signOut: () => Promise<void>;
  refresh: () => Promise<Entitlements | null>;
}

const AuthContext = createContext<AuthApi | null>(null);

/** Extract a stable error code from a thrown/failed auth step. */
function classifyError(err: unknown, serverCode?: string): SignInErrorCode {
  const raw = String(err?.toString?.() ?? err ?? "");
  if (serverCode === "RATE_LIMITED" || raw.includes("RATE_LIMITED")) return "RATE_LIMITED";
  if (raw.includes("UserRejected") || raw.includes("User rejected")) {
    return "SIGNATURE_REJECTED";
  }
  if (
    raw.includes("Failed to initialize request") ||
    raw.includes("popup") && raw.includes("blocked")
  ) {
    return "POPUP_BLOCKED";
  }
  if (raw.includes("Request timeout") || raw.includes("timed out")) return "TIMEOUT";
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

interface SessionState {
  loading: boolean;
  entitlements: Entitlements | null;
  signingIn: boolean;
  error: string | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, status, chainId } = useAccount();
  const { disconnect: walletLogout } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { connectors, connectAsync } = useConnect();
  const { t } = useI18n();

  // Mirror of wagmi's account status for async callbacks (watcher sync)
  // that outlive the render they were created in.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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

  // Re-fetch the session whenever the connected ACCOUNT changes (connect /
  // disconnect / account switch) — not just on mount. Shared by every
  // section through this provider: ONE fetch flips every gate live, which
  // is precisely what the user previously only got from a full reload.
  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [address, refresh]);

  /**
   * Pre-warm the AGW (privy cross-app) provider after mount.
   *
   * The cross-app client lazily fetches provider details from auth.privy.io
   * before it can open the connect popup. Warming it up once at mount means
   * the popup opens ~instantly when the user later clicks "Connect Wallet" —
   * comfortably inside the browser's transient-activation window, which is
   * what keeps the popup from being blocked.
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
   * Never throws — inspect the returned result for flow control; failures
   * toast a localized message HERE (single source, no double-toasting).
   */
  const signIn = useCallback(
    async (): Promise<SignInResult> => {
      if (!address) {
        // Defensive: every signIn call-site is gated on a connected wallet,
        // but a mid-flight disconnect must still not fail silently.
        toast.error(t("wallet.error.NETWORK"));
        return { ok: false, errorCode: "NETWORK" };
      }
      setState((s) => ({ ...s, signingIn: true, error: null }));
      const fail = (code: SignInErrorCode): SignInResult => {
        log.warn("sign-in failed", { code });
        setState((s) => ({ ...s, signingIn: false, error: code }));
        // Centralized feedback: an auth step must NEVER fail silently
        // ("I click a plan and nothing happens"). Callers must NOT
        // double-toast — inspect the returned result for flow control only.
        toast.error(t(`wallet.error.${code}`));
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
    [address, signMessageAsync, refresh, t],
  );

  // NOTE: no automatic sign-in effect here. Opening the AGW signature
  // popup without a user gesture is exactly what gets it blocked by
  // browsers (official AGW examples sign from explicit clicks only).
  // The Header / gates cover the connected-but-signed-out state —
  // `needsSignIn` below tells the UI when to highlight them.

  /**
   * Connect the Abstract Global Wallet (owned promise — not the SDK's
   * fire-and-forget login).
   *  - every failure (blocked popup, unreachable AGW domains, timeout, …)
   *    surfaces as a localized toast;
   *  - arms the agw-bridge connection watcher so, if the popup's live
   *    postMessage path breaks, wagmi still adopts the persisted
   *    connection the moment it lands — no page reload needed.
   * MUST be called from a click handler (AGW popup = window.open).
   */
  const login = useCallback(async (): Promise<void> => {
    const connector = connectors.find((c) => c.id === "xyz.abs.privy" || c.type === "privy");
    if (!connector) {
      log.warn("AGW connector not found");
      toast.error(t("wallet.error.CONNECTOR_MISSING"));
      return;
    }

    armConnectionWatch({
      probe: async () => {
        try {
          const accounts = await connector.getAccounts();
          return accounts[0] ?? null;
        } catch {
          return null;
        }
      },
      sync: async () => {
        if (statusRef.current === "connected") return; // live path already worked
        try {
          await connectAsync({ connector });
          log.debug("wallet connection force-synced via bridge watcher");
        } catch (err) {
          log.warn("bridge watcher sync failed", { err: String(err) });
        }
      },
    });

    try {
      await connectAsync({ connector });
      // Success: wagmi's store updates → every useAccount() subscriber
      // re-renders, and the [address] effect above re-fetches the session
      // ONCE for the whole app through this shared provider.
    } catch (err) {
      // The bridge watcher may have force-synced the connection while the
      // popup's own promise was still pending (lost postMessage) — in that
      // case the eventual popup timeout is stale noise, not a user error.
      if (statusRef.current === "connected") return;
      const code = classifyError(err);
      log.warn("connect failed", { code, err: String(err) });
      toast.error(t(`wallet.error.${code}`));
    }
  }, [connectAsync, connectors, t]);

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

  const api = useMemo<AuthApi>(
    () => ({
      address,
      walletStatus: status,
      chainId,
      ...state,
      needsSignIn,
      login,
      signIn,
      signOut,
      refresh,
    }),
    [address, status, chainId, state, needsSignIn, login, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

/** Internal: read the shared auth context (useAuth is the public wrapper). */
export function useAuthContext(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider> (see components/Providers)");
  }
  return ctx;
}
