/**
 * GET /api/user-profile/[address] — Abstract Portal profile proxy.
 *
 * Fetches the Abstract Portal profile for a wallet address (avatars, tier,
 * badges) from the public Portal API and returns a slim, UI-ready shape.
 * A missing profile is NOT an error: `{ ok: true, profile: null }` so the
 * frontend can fall back to a plain identicon-style avatar.
 *
 * Docs: https://build.abs.xyz/docs/abstract-portal/abstract-profile
 *
 * @module app/api/user-profile/[address]
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { isValidAddress, avatarAssetUrl, normalizeBadgeIcon, safeHttpUrl, PORTAL_PROFILE_BASE, type AbstractProfileData } from "@/lib/abstract/profile";

const PORTAL_API = "https://backend.portal.abs.xyz/api";
const CACHE_S_MAXAGE = 300; // 5 min, matches the official reusable

interface RawPortalBadge {
  badge?: {
    id?: number;
    type?: string;
    name?: string;
    icon?: string;
    description?: string;
    url?: string;
  };
  claimed?: boolean;
}

interface RawPortalUser {
  name?: string;
  tier?: number;
  avatar?: { tier?: number; key?: number; season?: number };
  overrideProfilePictureUrl?: string;
  badges?: RawPortalBadge[];
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const limited = guard(req, "public");
  if (limited) return limited;

  const { address } = await params;
  if (!address || !isValidAddress(address)) {
    return NextResponse.json({ ok: false, error: "INVALID_ADDRESS" }, { status: 400 });
  }
  const checksummed = address;

  try {
    const res = await fetch(`${PORTAL_API}/user/address/${checksummed}`, {
      headers: {
        accept: "application/json",
        "user-agent": "PenguSignals/1.0 (+https://abs.xyz)",
      },
      // Next.js fetch cache: revalidate every 5 minutes (matches official reusable)
      next: { revalidate: CACHE_S_MAXAGE },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404 || res.ok === false) {
      // Portal returns 200 with {"error": "... not found"} in some cases; treat both as "no profile"
      const body: unknown = await res.json().catch(() => null);
      const notFound =
        res.status === 404 ||
        (body as { error?: string } | null)?.error?.toLowerCase().includes("not found");
      if (notFound) {
        return NextResponse.json(
          { ok: true, profile: null },
          { headers: { "cache-control": `private, max-age=60` } },
        );
      }
      return NextResponse.json({ ok: false, error: "PORTAL_UPSTREAM" }, { status: 502 });
    }

    const raw = (await res.json()) as { user?: RawPortalUser };
    const user = raw.user ?? {};

    // Portal override pictures are user-controlled: only accept absolute
    // http(s) URLs, else fall back to the generated tier asset (a relative or
    // malformed override would 404 against OUR origin, same bug class as
    // badge icon slugs).
    const avatarSrc =
      safeHttpUrl(user.overrideProfilePictureUrl) ||
      avatarAssetUrl(
        user.avatar?.tier ?? 1,
        user.avatar?.key ?? 1,
        user.avatar?.season ?? 1,
      );

    const claimed = (user.badges ?? []).filter((b) => b.claimed !== false && b.badge);
    const badges = claimed.slice(0, 8).map((b) => ({
      id: b.badge!.id ?? 0,
      type: b.badge!.type ?? "",
      name: b.badge!.name ?? "",
      // Portal sends icon SLUGS ("twitter", …) — never render them as <img src>.
      ...normalizeBadgeIcon(b.badge!.icon),
      description: b.badge!.description ?? "",
      url: b.badge!.url,
    }));

    const profile: AbstractProfileData = {
      name: user.name && user.name.length > 0 ? user.name : null,
      tier: typeof user.tier === "number" && user.tier >= 1 && user.tier <= 5 ? user.tier : 1,
      avatarSrc,
      badgeCount: claimed.length,
      badges,
      portalUrl: `${PORTAL_PROFILE_BASE}/${checksummed}`,
    };

    return NextResponse.json(
      { ok: true, profile },
      { headers: { "cache-control": `public, s-maxage=${CACHE_S_MAXAGE}, stale-while-revalidate=600` } },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "PORTAL_UNREACHABLE" }, { status: 502 });
  }
}
