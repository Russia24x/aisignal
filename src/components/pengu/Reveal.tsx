"use client";

/**
 * Reveal — scroll-triggered entrance animation wrapper.
 *
 * Fades + rises + de-blurs its children the first time they enter the
 * viewport (IntersectionObserver, `once`). Fully static-friendly: content
 * is rendered from the start (only opacity/transform/filter animate), so
 * SEO/print/noscript all see the content.
 *
 * Accessibility: honours `prefers-reduced-motion` — when set, children are
 * shown immediately with no transition.
 *
 * @module components/pengu/Reveal
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RevealProps {
  children: ReactNode;
  /** Extra classes for the wrapper div. */
  className?: string;
  /** Stagger delay in ms (0–600). */
  delay?: number;
  /** Vertical travel in px (default 24). */
  rise?: number;
}

export function Reveal({ children, className, delay = 0, rise = 24 }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Content already above the fold (or reduced motion) → reveal on the
    // next frame — async to avoid a synchronous cascading render; one
    // frame of hidden state is imperceptible.
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      el.getBoundingClientRect().top < window.innerHeight
    ) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      // start slightly before the element is fully in view
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("reveal", visible && "reveal-in", className)}
      style={{
        transitionDelay: visible ? `${Math.min(Math.max(delay, 0), 600)}ms` : "0ms",
        ["--reveal-rise" as string]: `${rise}px`,
      }}
    >
      {children}
    </div>
  );
}
