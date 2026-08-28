"use client";

/**
 * MoodGauge — animated semicircular market-mood dial.
 *
 * Turns the public consensus counts (bullish/bearish/neutral indicators)
 * into a single glanceable needle score:
 *
 *   score = (bullish − bearish) / total   ∈ [−1 … +1]
 *
 * −1 → needle hard left (deep red), +1 → hard right (deep green).
 * Zero-cost feature: consumes only the existing /api/signal/preview
 * payload — no new backend surface.
 *
 * Accessibility: the gauge is decorative — the exact counts stay as text
 * beside it (screen readers never depend on the needle), and the dial
 * itself carries an aria-label with the mood phrase.
 *
 * @module components/pengu/MoodGauge
 */
import { useI18n } from "@/components/i18n/I18nProvider";
import { cn } from "@/lib/utils";

export interface MoodInput {
  bullish: number;
  bearish: number;
  neutral: number;
  total: number;
}

/** Map a −1…+1 score to a mood bucket key. */
function moodKey(score: number): "veryBullish" | "bullish" | "neutral" | "bearish" | "veryBearish" {
  if (score >= 0.45) return "veryBullish";
  if (score >= 0.15) return "bullish";
  if (score <= -0.45) return "veryBearish";
  if (score <= -0.15) return "bearish";
  return "neutral";
}

const MOOD_COLOR: Record<string, string> = {
  veryBullish: "text-buy",
  bullish: "text-buy",
  neutral: "text-hold",
  bearish: "text-sell",
  veryBearish: "text-sell",
};

export function MoodGauge({ consensus, className }: { consensus: MoodInput; className?: string }) {
  const { t } = useI18n();

  const total = Math.max(1, consensus.total);
  const score = (consensus.bullish - consensus.bearish) / total; // −1 … +1
  const pct = Math.round(score * 100); // −100 … +100
  const key = moodKey(score);
  const label = t(`signal.mood.${key}`);

  // needle: score −1 → +90° (left), 0 → 0° (up), +1 → −90° (right)
  const angle = score * -90;

  return (
    <div className={cn("flex flex-col items-center", className)} dir="ltr">
      <svg
        viewBox="0 0 200 108"
        className="w-full max-w-[220px]"
        role="img"
        aria-label={`${label} (${pct >= 0 ? "+" : ""}${pct})`}
      >
        <defs>
          <linearGradient id="mood-arc" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--sell)" />
            <stop offset="35%" stopColor="var(--sell)" stopOpacity="0.85" />
            <stop offset="50%" stopColor="var(--hold)" />
            <stop offset="65%" stopColor="var(--buy)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--buy)" />
          </linearGradient>
        </defs>

        {/* track */}
        <path
          d="M 22 88 A 78 78 0 0 1 178 88"
          fill="none"
          stroke="var(--muted)"
          strokeOpacity="0.35"
          strokeWidth="11"
          strokeLinecap="round"
        />
        {/* colored mood arc */}
        <path
          d="M 22 88 A 78 78 0 0 1 178 88"
          fill="none"
          stroke="url(#mood-arc)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeOpacity="0.9"
        />
        {/* zone ticks: 25 / 50 / 75 % */}
        {[60, 90, 120].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 100 + 62 * Math.cos(rad);
          const y1 = 88 - 62 * Math.sin(rad);
          const x2 = 100 + 74 * Math.cos(rad);
          const y2 = 88 - 74 * Math.sin(rad);
          return (
            <line
              key={deg}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--background)"
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.55"
            />
          );
        })}

        {/* needle — animated via CSS transition on the group */}
        <g className="mood-needle" style={{ transform: `rotate(${angle}deg)` }}>
          <polygon
            points="100,34 96.6,88 103.4,88"
            fill="var(--foreground)"
            opacity="0.92"
          />
          <circle cx="100" cy="88" r="7.5" fill="var(--foreground)" opacity="0.92" />
          <circle cx="100" cy="88" r="3" fill="var(--background)" />
        </g>

        {/* endpoints */}
        <text x="20" y="104" fontSize="13" fill="var(--sell)" fontWeight="700">🐻</text>
        <text x="166" y="104" fontSize="13" fill="var(--buy)" fontWeight="700">🐂</text>
      </svg>

      <div className="-mt-1 flex flex-col items-center gap-0.5">
        <span className={cn("text-lg font-black tabular-nums", MOOD_COLOR[key])}>
          {pct >= 0 ? "+" : ""}
          {pct}
        </span>
        <span className={cn("text-xs font-bold", MOOD_COLOR[key])}>{label}</span>
        <span className="text-[10px] text-muted-foreground/80">{t("signal.mood.hint")}</span>
      </div>
    </div>
  );
}
