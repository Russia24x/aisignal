"use client";

/**
 * useAbstractProfile — react-query hook for the Abstract Portal profile.
 *
 * Mirrors the official AGW Reusables hook (build.abs.xyz) adapted to our
 * API route and data shape. Profile data is cached for 2 minutes client-side.
 *
 * @module hooks/useAbstractProfile
 */
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { AbstractProfileData } from "@/lib/abstract/profile";

async function fetchProfile(address: string): Promise<AbstractProfileData | null> {
  const res = await fetch(`/api/user-profile/${address}`);
  if (!res.ok) return null; // upstream hiccups must not break the UI
  const json = (await res.json()) as { ok: boolean; profile: AbstractProfileData | null };
  return json.profile ?? null;
}

/** Profile for the currently connected wallet (null until connected). */
export function useAbstractProfile() {
  const { address, isConnecting, isReconnecting } = useAccount();
  return useAbstractProfileByAddress(address, isConnecting || isReconnecting);
}

/** Profile for a specific address (used for demo/preview rows). */
export function useAbstractProfileByAddress(
  address: `0x${string}` | undefined,
  busy = false,
) {
  const query = useQuery({
    queryKey: ["abstract-profile", address ?? null],
    queryFn: () => fetchProfile(address!),
    enabled: !!address,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    ...query,
    isLoading: busy || (!!address && query.isLoading),
  };
}
