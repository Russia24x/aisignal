"use client";

/**
 * AGW network-resilience bridge (client-side, installed once before the
 * Abstract SDK boots).
 *
 * WHY THIS EXISTS (root-cause analysis of the user-visible failures):
 *  1. "I click Connect / a plan and NOTHING happens":
 *     every AGW popup (connect, signature, transaction) is opened AFTER the
 *     SDK resolves its provider-details document from `auth.privy.io`. On
 *     filtered networks that domain is unreachable → the details fetch dies
 *     → the popup never opens → connect/sign-in/purchase silently stall
 *     (worst case: the SDK hangs for its 2-minute popup timeout).
 *  2. "Runtime TypeError: Failed to fetch" (dev overlay): the SDK
 *     fire-and-forgets that details fetch at construction; its rejection was
 *     unhandled.
 *  3. "Wallet connects in the header but other sections stay 'not connected'
 *     until refresh": if the popup's live postMessage path breaks, the
 *     connection is only persisted; wagmi notices after a full reload. The
 *     watcher below does the reload's job, live.
 *
 * WHAT THE BRIDGE DOES NOW:
 *  - PROVIDER-DETAILS RESOLUTION CHAIN (the big one): the details document
 *    is public, tiny and stable — so it is (a) pre-warmed from our own
 *    `/api/agw/details` proxy at page load, (b) served from an in-memory
 *    cache to the SDK instantly, and (c) guaranteed by a bundled-constants
 *    last resort. `auth.privy.io` can never block a popup again — the SDK
 *    always receives valid portal.abs.xyz URLs in ~0ms.
 *  - POPUP SENTINEL: `window.open` is wrapped to record successful opens;
 *    `popupOpenGuard()` lets useAuth fail fast with "popup blocked"
 *    feedback instead of a silent 2-minute hang.
 *  - unhandledrejection guard: safety net for any remaining SDK warm-up
 *    rejection (kept out of the Next.js dev overlay).
 *  - connection watcher: poll manager used by useAuth to adopt a persisted
 *    AGW connection without a page reload.
 *
 * @module lib/agw-bridge
 */
import {
  AGW_DETAILS_FALLBACK,
  AGW_DETAILS_PROXY_URL,
  AGW_DETAILS_URL,
  looksLikeAgwDetails,
  type AgwProviderDetails,
} from "@/lib/agw-details";
import { createLogger } from "@/lib/client-logger";

const log = createLogger("agw-bridge");

/** URL fragment that uniquely identifies the AGW provider-details request. */
const DETAILS_URL_RE = /\/api\/v1\/apps\/[^/]+\/cross-app\/details/;

/** How long a cached details document is trusted (matches the proxy route). */
const DETAILS_TTL_MS = 60 * 60 * 1000;

/** Tag attached to errors that this bridge already handled. */
const BRIDGE_TAG = "__agwBridgeRetried";

/* ---------------------------- state (module) ---------------------------- */

let installed = false;
let origFetch: typeof window.fetch | null = null;
let origOpen: typeof window.open | null = null;

let detailsCache: { json: AgwProviderDetails; at: number } | null = null;
let primingPromise: Promise<void> | null = null;

/** Timestamps of successful window.open() calls (capped). */
const popupOpens: number[] = [];
/** Timestamps of window.open() calls the browser refused (null return). */
const popupBlocks: number[] = [];
const POPUP_LOG_CAP = 32;


/* ------------------------------ details -------------------------------- */

function cacheDetails(json: unknown): void {
  if (looksLikeAgwDetails(json)) {
    detailsCache = { json, at: Date.now() };
  }
}

function syntheticDetailsResponse(json: AgwProviderDetails): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function detailsFresh(): AgwProviderDetails | null {
  if (detailsCache && Date.now() - detailsCache.at < DETAILS_TTL_MS) {
    return detailsCache.json;
  }
  return null;
}

async function fetchDetailsFrom(url: string, timeoutMs: number): Promise<AgwProviderDetails> {
  if (!origFetch) throw new Error("bridge not installed");
  const res = await origFetch(url, {
    method: "GET",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: unknown = await res.json();
  if (!looksLikeAgwDetails(json)) throw new Error("malformed details document");
  return json;
}

/**
 * Pre-warm the details cache at page load: same-origin proxy first (fast,
 * reliable, server-side cached), upstream as backup. By the time a user
 * clicks anything, the cache is hot and the SDK's fetch resolves in ~0ms —
 * the popup opens instantly, well inside the browser's transient-activation
 * window.
 */
function primeDetails(): Promise<void> {
  const run = async () => {
    try {
      // Same-origin proxy first: fast, reliable, and its server fetches
      // upstream with its own cache + fallback.
      cacheDetails(await fetchDetailsFrom(AGW_DETAILS_PROXY_URL, 4000));
      return;
    } catch {
      /* proxy unreachable — try upstream directly */
    }
    try {
      cacheDetails(await fetchDetailsFrom(AGW_DETAILS_URL, 4000));
    } catch {
      /* both unreachable — bundled constants are used lazily */
    }
  };
  return run();
}

function ensurePrimed(): Promise<void> {
  if (detailsFresh()) return Promise.resolve();
  if (!primingPromise) primingPromise = primeDetails();
  return primingPromise;
}

/** True once the details document is cached and fresh. */
export function agwDetailsReady(): boolean {
  return detailsFresh() !== null;
}

/* ------------------------------ popup log ------------------------------- */

/** True when at least one popup was successfully opened at/after `since`. */
export function popupOpenedSince(since: number): boolean {
  return popupOpens.some((t) => t >= since);
}

/** True when the browser REFUSED a window.open at/after `since` (popup blocker). */
export function popupBlockedSince(since: number): boolean {
  return popupBlocks.some((t) => t >= since);
}

/**
 * Fail-fast guard for AGW popup flows. Rejects with a "popup blocked" style
 * error when no `window.open` succeeded within the grace window — while the
 * SDK itself would otherwise hang silently for up to TWO MINUTES. Once a
 * popup opens (or the details document is still resolving) the guard stands
 * down and the underlying SDK promise decides the outcome.
 */
export function popupOpenGuard(startedAt: number): Promise<never> {
  const p = new Promise<never>((_, reject) => {
    const tick = () => {
      if (popupOpenedSince(startedAt)) return; // popup open — stand down
      const graceMs = agwDetailsReady() ? 2_500 : 8_000; // cold details → wait longer
      if (Date.now() - startedAt >= graceMs) {
        reject(new Error("AGW popup blocked: wallet window did not open"));
        return;
      }
      setTimeout(tick, 250);
    };
    setTimeout(tick, 250);
  });
  // If the raced-against promise settles first, a late rejection here would
  // otherwise become an unhandled rejection — absorb it.
  p.catch(() => undefined);
  return p;
}

/* ---------------------------- install (once) ---------------------------- */

export function installAgwBridge(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  origFetch = window.fetch.bind(window);
  origOpen = window.open.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url || !DETAILS_URL_RE.test(url)) return origFetch!(input, init);

    // 1) Hot cache → instant synthetic response (the normal path: the
    //    document was pre-warmed at page load).
    const fresh = detailsFresh();
    if (fresh) return syntheticDetailsResponse(fresh);

    // 2) Wait for the page-load priming (covers clicks in the first ~seconds).
    await ensurePrimed().catch(() => undefined);
    const primed = detailsFresh();
    if (primed) return syntheticDetailsResponse(primed);

    // 3) Direct upstream attempt, short timeout (preserves freshness for
    //    unfiltered networks when priming somehow failed).
    try {
      cacheDetails(await fetchDetailsFrom(url, 2_500));
      if (detailsCache) return syntheticDetailsResponse(detailsCache.json);
    } catch {
      /* fall through to the same-origin proxy */
    }

    // 4) Same-origin proxy — our own server (always reachable for the user).
    try {
      cacheDetails(await fetchDetailsFrom(AGW_DETAILS_PROXY_URL, 4_000));
      if (detailsCache) return syntheticDetailsResponse(detailsCache.json);
    } catch {
      /* final fallback below */
    }

    // 5) Bundled public constants — this request can no longer fail, so the
    //    SDK never dead-ends on a filtered network again.
    cacheDetails(AGW_DETAILS_FALLBACK);
    log.warn("provider-details served from bundled constants (upstream + proxy unreachable)");
    return syntheticDetailsResponse(AGW_DETAILS_FALLBACK);
  };

  // Popup sentinel — transparent wrapper. Successful opens AND refused opens
  // (popup blocker) are recorded separately: the SDK's connect error for a
  // refused open is an unclassifiable `Error("")` — the block log lets
  // useAuth attribute it to POPUP_BLOCKED accurately.
  window.open = ((...args: Parameters<typeof window.open>) => {
    const w = origOpen!(...args);
    if (w) {
      popupOpens.push(Date.now());
      if (popupOpens.length > POPUP_LOG_CAP) popupOpens.shift();
    } else {
      popupBlocks.push(Date.now());
      if (popupBlocks.length > POPUP_LOG_CAP) popupBlocks.shift();
    }
    return w;
  }) as typeof window.open;

  // Safety net for any remaining SDK-internal rejection around the details
  // warm-up (with the chain above this should be unreachable).
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as (Error & { [k: string]: unknown }) | undefined;
    const tagged = reason && typeof reason === "object" && reason[BRIDGE_TAG] === true;
    if (tagged) {
      log.warn("contained SDK warm-up rejection", {
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      e.preventDefault();
    }
  });

  // Pre-warm the details document NOW (same-origin, fast) so the first
  // connect/sign popup opens instantly.
  void ensurePrimed();
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
