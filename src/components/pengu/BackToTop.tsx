"use client";

/**
 * BackToTop — floating scroll-to-top button with a circular progress ring.
 *
 * Behaviour:
 * - Hidden until the user scrolls past ~15% of the document.
 * - The ring stroke fills clockwise as scroll progress grows (0→100%).
 * - Click: smooth scroll to top (instant when prefers-reduced-motion).
 * - Keyboard accessible, RTL-safe (pinned to the inline-end corner),
 *   respects iOS safe-area insets, sits under modals/dropdowns (z-40).
 *
 * @module components/pengu/BackToTop
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { cn } from "@/lib/utils";

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function BackToTop() {
  const { t } = useI18n();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        setProgress(p);
        setVisible(window.scrollY > window.innerHeight * 0.9 && p > 0.08);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const goTop = useCallback(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, []);

  const dash = CIRCUMFERENCE * (1 - progress);

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label={t("common.backToTop")}
      title={t("common.backToTop")}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] end-4 z-40",
        "grid size-11 place-items-center rounded-full",
        "border border-border/70 bg-card/85 backdrop-blur-xl",
        "shadow-lg shadow-black/25 transition-all duration-300",
        "hover:border-primary/60 hover:shadow-primary/25 hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
        "active:translate-y-0 active:scale-95",
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      {/* progress ring */}
      <svg
        className="absolute inset-0 size-full -rotate-90"
        viewBox="0 0 48 48"
        aria-hidden
      >
        <circle
          cx="24"
          cy="24"
          r={RADIUS}
          fill="none"
          stroke="var(--border)"
          strokeWidth="2.5"
        />
        <circle
          cx="24"
          cy="24"
          r={RADIUS}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dash}
          style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>
      <ArrowUp
        className={cn(
          "size-4.5 transition-transform duration-300",
          progress > 0.97 ? "text-primary" : "text-muted-foreground",
        )}
        aria-hidden
      />
    </button>
  );
}
