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
  icon: string;
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
