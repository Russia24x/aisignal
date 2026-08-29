/**
 * Abstract Portal profile integration.
 *
 * Data source: https://backend.portal.abs.xyz/api/user/address/{address}
 * (public Abstract Portal API — see https://build.abs.xyz/docs/abstract-portal/abstract-profile)
 *
 * Tiers: 1 = Bronze, 2 = Silver, 3 = Gold, 4 = Platinum, 5 = Diamond.
 * Avatars resolve via overrideProfilePictureUrl when set, otherwise the
 * generated season asset https://abstract-assets.abs.xyz/avatars/{tier}-{key}-{season}.png.
 *
 * @module lib/abstract/profile
 */
import { isAddress } from "viem";

export interface PortalBadge {
  id: number;
  type: string;
  name: string;
  /** Absolute https URL only — Portal slugs are never URLs (see normalizeBadgeIcon). */
  iconUrl: string | null;
  /** Sanitized Portal icon slug (e.g. "twitter") for client-side icon mapping. */
  iconSlug: string | null;
  description: string;
  url?: string;
}

/** Slim profile shape our UI consumes (server trims the full Portal payload). */
export interface AbstractProfileData {
  name: string | null;
  tier: number;
  avatarSrc: string;
  badgeCount: number;
  badges: PortalBadge[];
  portalUrl: string;
}

export const PORTAL_PROFILE_BASE = "https://abs.xyz/profile";

/** Maps tier numbers to their Abstract Portal colors. */
export const TIER_COLORS: Record<number, string> = {
  1: "#CD7F32", // Bronze
  2: "#C0C0C0", // Silver
  3: "#FFD700", // Gold
  4: "#E5E4E2", // Platinum
  5: "#B9F2FF", // Diamond
};

export function getTierColor(tier: number): string {
  return TIER_COLORS[tier] ?? TIER_COLORS[1];
}

export function isValidAddress(value: string): boolean {
  return isAddress(value);
}

/** Construct the generated avatar asset URL, mirroring the official component. */
export function avatarAssetUrl(tier: number, key: number, season: number): string {
  return `https://abstract-assets.abs.xyz/avatars/${tier}-${key}-${season}.png`;
}

/** Accept only well-formed absolute http(s) URLs from Portal-provided values. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

/**
 * Normalize a raw Portal badge "icon" value.
 *
 * The Portal API returns icon *slugs* ("twitter", "the-trader", …), not URLs —
 * there is no public badge-icon CDN. Rendering a slug as <img src> makes the
 * browser request e.g. GET /twitter on OUR origin → 404 noise in the console
 * for every claimed badge. Split the value into:
 *  - iconUrl:  absolute http(s) URL if (and only if) the value is one
 *  - iconSlug: sanitized slug ([a-z0-9-], ≤40 chars) for client icon mapping
 */
export function normalizeBadgeIcon(
  raw: string | null | undefined,
): { iconUrl: string | null; iconSlug: string | null } {
  const value = (raw ?? "").trim();
  if (!value) return { iconUrl: null, iconSlug: null };

  const iconUrl = safeHttpUrl(value);
  if (iconUrl) return { iconUrl, iconSlug: null };

  const slug = value.toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
    return { iconUrl: null, iconSlug: slug };
  }
  return { iconUrl: null, iconSlug: null };
}
