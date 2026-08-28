"use client";

/**
 * ShareButton — viral loop for the platform.
 *
 * Builds a live share card from REAL data (DexScreener price + the free
 * signal preview's indicator consensus) and shares it:
 *  - native Web Share API when the browser supports it (mobile-first)
 *  - X / Twitter intent + Telegram share + copy-link as universal options
 *
 * Self-contained: fetches the public preview itself (no props, no
 * react-query dependency) and reads the live snapshot via useMarket.
 *
 * @module components/pengu/ShareButton
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMarket, fmt } from "./useMarket";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Link2, Send, Share2, Twitter } from "lucide-react";
import { toast } from "sonner";

interface PreviewConsensus {
  ok: boolean;
  consensus: { bullish: number; bearish: number; total: number } | null;
}

export function ShareButton({ size = "lg" as const }: { size?: "sm" | "lg" }) {
  const { t, locale } = useI18n();
  const { data } = useMarket();
  const [consensus, setConsensus] = useState<PreviewConsensus["consensus"] | null>(null);
  const [copied, setCopied] = useState(false);

  // Public preview — consensus only (the verdict itself stays paywalled).
  useEffect(() => {
    fetch("/api/signal/preview", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PreviewConsensus) => {
        if (d.ok) setConsensus(d.consensus);
      })
      .catch(() => undefined);
  }, []);

  const url = typeof window !== "undefined" ? window.location.origin : "";
  const fa = locale === "fa";

  const shareText = (() => {
    const s = data?.snapshot;
    const parts: string[] = [];
    parts.push(fa ? "🐧 سیگنال روزانهٔ پنگو — PenguSignals" : "🐧 Daily PENGU signals — PenguSignals");
    if (s) {
      const pct = (s.change24h ?? 0) >= 0 ? "+" : "";
      parts.push(
        fa
          ? `پنگو ${fmt.price(s.priceUsd)} (${pct}${(s.change24h ?? 0).toFixed(1)}٪ در ۲۴ ساعت)`
          : `PENGU ${fmt.price(s.priceUsd)} (${pct}${(s.change24h ?? 0).toFixed(1)}% 24h)`,
      );
    }
    if (consensus && consensus.total > 0) {
      parts.push(
        fa
          ? `اجماع امروز: ${consensus.bullish} از ${consensus.total} اندیکاتور صعودی 📊`
          : `Today's consensus: ${consensus.bullish}/${consensus.total} indicators bullish 📊`,
      );
    }
    parts.push(fa ? "روی زنجیرهٔ Abstract ⛓️" : "Built on Abstract ⛓️");
    return parts.join("\n");
  })();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${url}`);
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t("common.error"));
    }
  };

  const nativeShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "PenguSignals", text: shareText, url });
        return true;
      } catch {
        /* user dismissed — fall through to dropdown options */
      }
    }
    return false;
  };

  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant="outline" className="gap-2 font-bold">
          <Share2 className="size-4" />
          {t("share.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {/* native share first when available (mobile) */}
        {typeof navigator !== "undefined" && "share" in navigator && (
          <DropdownMenuItem className="gap-2 font-semibold" onClick={() => void nativeShare()}>
            <Share2 className="size-4" />
            {t("share.native")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href={xHref} target="_blank" rel="noreferrer noopener" className="flex cursor-pointer items-center gap-2 font-semibold">
            <Twitter className="size-4" />
            {t("share.onX")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={tgHref} target="_blank" rel="noreferrer noopener" className="flex cursor-pointer items-center gap-2 font-semibold">
            <Send className="size-4" />
            {t("share.onTelegram")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 font-semibold" onClick={() => void copyLink()}>
          {copied ? <Check className="size-4 text-buy" /> : <Link2 className="size-4" />}
          {copied ? t("common.copied") : t("share.copy")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
