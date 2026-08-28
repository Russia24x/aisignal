/**
 * AGW provider-details constants (client-safe).
 *
 * The AGW SDK (@privy-io/cross-app-connect) must fetch a tiny public JSON
 * document from `auth.privy.io` before it can open ANY popup (connect /
 * sign / transact) — the document only tells it WHERE the popups live
 * (portal.abs.xyz, Abstract's own domain).
 *
 * On filtered networks (e.g. Iran) `auth.privy.io` is frequently
 * unreachable, which used to kill every wallet popup at the source.
 * These constants let us serve the document from our OWN origin
 * (`/api/agw/details` proxy + bundled fallback) — removing privy.io from
 * the critical path entirely. The document is public by classification
 * (`data_classification: "public"`) and its URLs are stable.
 *
 * Verified live from
 * https://auth.privy.io/api/v1/apps/{AGW_PROVIDER_APP_ID}/cross-app/details
 * (2026-08-28). Refresh when Abstract changes portal domains.
 *
 * @module lib/agw-details
 */

/** The AGW provider app id (public — also shipped inside the SDK bundle). */
export const AGW_PROVIDER_APP_ID = "cm04asygd041fmry9zmcyn5o5";

/** Upstream document URL (the ONLY privy.io request the SDK ever makes). */
export const AGW_DETAILS_URL = `https://auth.privy.io/api/v1/apps/${AGW_PROVIDER_APP_ID}/cross-app/details`;

/** Same-origin proxy that serves the document without touching privy.io. */
export const AGW_DETAILS_PROXY_URL = "/api/agw/details";

/** Shape of the provider-details document (upstream field names). */
export interface AgwProviderDetails {
  name: string;
  icon_url: string;
  custom_api_url: string;
  custom_connect_url: string;
  custom_transact_url: string;
  data_classification: string;
}

/**
 * Bundled last-resort copy of the public document. Used only when BOTH the
 * upstream and our own proxy are unreachable — the SDK then still gets valid
 * portal.abs.xyz popup URLs instead of a dead "Failed to fetch".
 */
export const AGW_DETAILS_FALLBACK: AgwProviderDetails = {
  name: "Abstract",
  icon_url:
    "https://imagedelivery.net/oHBRUd2clqykxgDWmeAyLg/5f3f7510-6fb7-4bb0-b918-203a096af700/icon",
  custom_api_url: "https://privy.abs.xyz",
  custom_connect_url: "https://portal.abs.xyz/cross-app/connect",
  custom_transact_url: "https://portal.abs.xyz/cross-app/transact",
  data_classification: "public",
};

/** Runtime shape check so a broken upstream/proxy body is never cached. */
export function looksLikeAgwDetails(json: unknown): json is AgwProviderDetails {
  if (!json || typeof json !== "object") return false;
  const j = json as Record<string, unknown>;
  return (
    typeof j.custom_connect_url === "string" &&
    /^https?:\/\//.test(j.custom_connect_url) &&
    typeof j.custom_transact_url === "string" &&
    /^https?:\/\//.test(j.custom_transact_url)
  );
}
