"use client";

/**
 * AbstractProfile — avatar with Abstract Portal tier styling.
 *
 * Adapted from the official AGW Reusables component
 * (https://build.abs.xyz/docs/abstract-portal/abstract-profile) to PenguSignals:
 *  - tier-colored ring (Bronze → Diamond)
 *  - hover glow matching our glass-card language
 *  - tooltip with Portal display name (falls back to trimmed address)
 *  - graceful skeleton while loading, fallback initials when no profile
 *
 * @module components/abstract/AbstractProfile
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useAbstractProfileByAddress } from "@/hooks/useAbstractProfile";
import { getTierColor } from "@/lib/abstract/profile";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";

export interface AbstractProfileProps {
  address?: `0x${string}`;
  /** fallback initials when the image fails to load / no profile */
  fallback?: string;
  /** override ring color (defaults to tier color) */
  shineColor?: string;
  size?: "sm" | "md" | "lg";
  showTooltip?: boolean;
  className?: string;
}

function trimAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const SIZE_CLASSES = {
  sm: "size-7",
  md: "size-10",
  lg: "size-14",
} as const;

const FALLBACK_TEXT = {
  sm: "text-[9px]",
  md: "text-xs",
  lg: "text-sm",
} as const;

export function AbstractProfile({
  address: providedAddress,
  fallback: providedFallback,
  shineColor,
  size = "md",
  showTooltip = true,
  className,
}: AbstractProfileProps) {
  const { address: connectedAddress, isConnecting, isReconnecting } = useAccount();
  const address = providedAddress || connectedAddress;

  const fallback =
    providedFallback || (address ? address.slice(2, 4).toUpperCase() : "??");

  const { data: profile, isLoading } = useAbstractProfileByAddress(
    address,
    isConnecting || isReconnecting,
  );

  const ringColor = shineColor || getTierColor(profile?.tier ?? 1);

  const avatar = (
    <div
      className={cn(
        "relative rounded-full shrink-0 transition-shadow duration-300",
        "hover:shadow-[0_0_12px_rgba(255,255,255,0.25)]",
        SIZE_CLASSES[size],
        className,
      )}
      style={{ border: `2px solid ${ringColor}`, padding: 0 }}
      aria-label={address ? `Abstract profile avatar for ${trimAddress(address)}` : "Abstract profile avatar"}
    >
      <Avatar className="size-full">
        {isLoading || !address ? (
          <Skeleton className="size-full rounded-full" />
        ) : (
          <>
            <AvatarImage
              src={profile?.avatarSrc}
              alt="Abstract Portal avatar"
              className="object-cover"
            />
            <AvatarFallback className={cn("font-mono font-bold", FALLBACK_TEXT[size])}>
              {fallback}
            </AvatarFallback>
          </>
        )}
      </Avatar>
    </div>
  );

  if (!showTooltip) return avatar;

  const displayName = profile?.name || (address ? trimAddress(address) : "anon");

  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatar}</TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{displayName}</p>
      </TooltipContent>
    </Tooltip>
  );
}
