"use client";

/**
 * AGW network-resilience bridge (client-side, installed once before the
 * Abstract SDK boots).
 *
 * WHY THIS EXISTS (root-cause analysis of three user-visible failures):
 *  1. "Runtime TypeError: Failed to fetch" (dev overlay):
 *     wagmi's createConfig() fire-and-forgets `connector.setup()` → the AGW
 *     connector eagerly fetches its provider details from auth.privy.io.
 *     When that request fails (flaky / filtered networks), the floating
 *     promise rejects UNHANDLED → Next.js dev-overlay error, and the
 *     connector's event listeners are never attached.
 *  2. "Wallet connects in the header but other sections stay 'not connected'
 *     until refresh": the popup (portal.abs.xyz) delivers the connection via
 *     window.postMessage → if that live path breaks, the connection is only
 *     persisted in localStorage; wagmi only notices after a full reload
 *     (auto-reconnect). The watcher below does the reload's job, live.
 *  3. "Clicking a plan does nothing": `login()` / `signIn()` failures were
 *     fire-and-forget with no user feedback. (Fixed in useAuth — toasts.)
 *
 * WHAT THE BRIDGE DOES:
 *  - fetch patch: transparent retry (short backoff, well inside the popup's
 *    transient-activation window) for the AGW provider-details GET. If all
 *    attempts fail, the error rethrows with a private tag so (a) callers
 *    still see the real failure and (b) the guard below can recognise it.
 *  - unhandledrejection guard: swallows EXACTLY the tagged SDK warm-up
 *    rejections (preventDefault → no dev-overlay toast). The SDK retries the
 *    details fetch lazily on every later use — a failed warm-up is harmless.
 *  - connection watcher helpers: tiny module-level poll manager used by
 *    useAuth to detect a persisted AGW connection and force wagmi to pick
 *    it up without a page reload.
 *
 * @module lib/agw-bridge
 */

/** URL fragment that uniquely identifies the AGW provider-details request. */
const DETAILS_URL_RE = /\/api\/v1\/apps\/[^/]+\/cross-app\/details/;

/** Backoff between retries: ~0.25s, ~0.75s, ~2s → popup still opens in time. */
const RETRY_DELAYS_MS = [250, 750, 2000];

/** Tag attached to errors that this bridge already retried. */
const BRIDGE_TAG = "__agwBridgeRetried";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------- install (once) ---------------------------- */

let installed = false;

export function installAgwBridge(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url || !DETAILS_URL_RE.test(url)) return origFetch(input, init);

    // The AGW provider-details GET: retry transparently (idempotent GET).
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await origFetch(input, init);
        // Non-2xx = server answered; hand it to the SDK untouched.
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    // All retries failed — rethrow, but tagged so the guard below (and only
    // it) can recognise this exact SDK-internal warm-up failure.
    if (lastErr instanceof Error) {
      try {
        (lastErr as Error & { [BRIDGE_TAG]?: boolean })[BRIDGE_TAG] = true;
      } catch {
        /* frozen error object — guard falls back to message matching */
      }
    }
    throw lastErr;
  };

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as (Error & { [k: string]: unknown }) | undefined;
    const tagged =
      reason && typeof reason === "object" && reason[BRIDGE_TAG] === true;
    // Fallback for frozen/unmodifiable errors: match the known SDK signature
    // ("TypeError: Failed to fetch" whose stack crosses loadProviderDetails).
    const stackSig =
      reason instanceof TypeError &&
      /Failed to fetch/.test(reason.message) &&
      /loadProviderDetails|cross-app/.test(reason.stack ?? "");
    if (tagged || stackSig) {
      // Harmless SDK warm-up failure — the SDK lazily retries on next use
      // (and our fetch patch adds its own backoff). Keep it out of the
      // dev-overlay / page-error surface; log once for transparency.
      console.warn(
        "[agw-bridge] provider-details warm-up failed (will retry lazily):",
        reason instanceof Error ? reason.message : reason,
      );
      e.preventDefault();
    }
  });
}

/* --------------------------- connection watcher --------------------------- */

export interface WatchHandlers {
  /** Resolves the persisted AGW address (localStorage-backed), or null. */
  probe(): Promise<string | null>;
  /** Force wagmi to adopt the persisted connection (fast-path connect). */
  sync(): Promise<void>;
}

interface WatchState {
  timer: ReturnType<typeof setInterval> | null;
  deadline: number;
  handlers: WatchHandlers | null;
  tickBusy: boolean;
}

const watch: WatchState = { timer: null, deadline: 0, handlers: null, tickBusy: false };

const WATCH_POLL_MS = 2_000;
const WATCH_TIMEOUT_MS = 3 * 60_000; // covers the SDK's 2-minute popup timeout

function stopWatch(): void {
  if (watch.timer !== null) {
    clearInterval(watch.timer);
    watch.timer = null;
  }
  watch.handlers = null;
  watch.tickBusy = false;
}

async function watchTick(): Promise<void> {
  if (watch.tickBusy || !watch.handlers) return;
  watch.tickBusy = true;
  try {
    if (Date.now() > watch.deadline) {
      stopWatch();
      return;
    }
    const address = await watch.handlers.probe();
    if (address) {
      // Connection landed (popup confirmed) — let wagmi pick it up NOW,
      // without the page reload the user previously needed.
      await watch.handlers.sync();
      stopWatch();
    }
  } catch {
    /* keep polling until the deadline */
  } finally {
    watch.tickBusy = false;
  }
}

/**
 * Arm the connection watcher (idempotent — re-arming refreshes the deadline
 * and handlers). Called by useAuth right before the connect popup opens.
 */
export function armConnectionWatch(handlers: WatchHandlers): void {
  watch.handlers = handlers;
  watch.deadline = Date.now() + WATCH_TIMEOUT_MS;
  if (watch.timer === null) {
    watch.timer = setInterval(() => void watchTick(), WATCH_POLL_MS);
  }
}
