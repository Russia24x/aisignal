"use client";

/**
 * NextSignalCountdown — ticking HH:MM:SS until the next UTC midnight,
 * when the engine cuts a fresh daily signal.
 *
 * Classic daily-product urgency driver: signals refresh exactly once a
 * day at 00:00 UTC, so "time left today" == "time until the next signal".
 *
 * Hydration safety: the first client render shows the server-safe
 * placeholder (dashes) and the real countdown starts one tick after
 * mount — zero server/client mismatch.
 *
 * @module components/pengu/NextSignalCountdown
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";

function msUntilNextUtcMidnight(now: number): number {
  const d = new Date(now);
  const next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1, // next midnight
    0,
    0,
    0,
    0,
  );
  return next - now;
}

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function NextSignalCountdown({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setLeft(msUntilNextUtcMidnight(Date.now()));
    tick(); // start immediately after mount
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const urgent = left !== null && left < 2 * 60 * 60 * 1000; // final 2 hours

  return (
    <span
      title={t("signal.nextSignalHint")}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-bold tabular-nums",
        compact
          ? "border-border/60 bg-card/70 text-foreground"
          : urgent
            ? "border-hold/40 bg-hold/10 text-hold mood-breathe"
            : "border-border/60 bg-card/70 text-muted-foreground",
      )}
      dir="ltr"
    >
      <Hourglass className={cn("size-3.5", urgent && "mood-breathe")} />
      {!compact && <span className="font-sans font-bold">{t("signal.nextSignal")}</span>}
      <span className={urgent ? "text-hold" : undefined}>
        {left === null ? "--:--:--" : fmtLeft(left)}
      </span>
    </span>
  );
}
