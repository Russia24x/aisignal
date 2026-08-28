/**
 * OG image endpoint — returns a static SVG card (1200×630) describing the
 * app brand. SVG keeps the route tiny, dependency-free, and infinitely
 * scalable. We can swap to a sharp-generated PNG later if needed.
 *
 * Cache: 1 hour on the CDN. Static content (no per-request data) so it's
 * fully cacheable.
 *
 * @route GET /api/og
 */
import { NextResponse } from "next/server";

export const revalidate = 3600; // 1h ISR
export const dynamic = "force-static";

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a1418"/>
      <stop offset="60%" stop-color="#0e1c22"/>
      <stop offset="100%" stop-color="#071014"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#07C983"/>
      <stop offset="50%" stop-color="#2FE6D2"/>
      <stop offset="100%" stop-color="#07C983"/>
    </linearGradient>
    <radialGradient id="orb" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#07C983" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#07C983" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
      <path d="M0 44V0M44 0H0" fill="none" stroke="#1a3036" stroke-width="0.5" opacity="0.45"/>
    </pattern>
  </defs>

  <!-- background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)" opacity="0.4"/>
  <circle cx="980" cy="120" r="320" fill="url(#orb)"/>
  <circle cx="160" cy="520" r="220" fill="url(#orb)" opacity="0.55"/>

  <!-- top accent line -->
  <rect x="80" y="80" width="200" height="3" rx="1.5" fill="url(#accent)"/>

  <!-- badge -->
  <g transform="translate(80, 110)">
    <rect x="0" y="0" width="240" height="36" rx="18" fill="#07C983" fill-opacity="0.12" stroke="#07C983" stroke-opacity="0.35"/>
    <circle cx="22" cy="18" r="5" fill="#2FE6D2"/>
    <text x="38" y="23" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" font-weight="700" fill="#2FE6D2" letter-spacing="0.5">BUILT ON ABSTRACT CHAIN</text>
  </g>

  <!-- title -->
  <text x="80" y="260" font-family="ui-sans-serif, system-ui, sans-serif" font-size="84" font-weight="900" fill="#f5fafc">
    Buy &amp; Sell Signals for
  </text>
  <text x="80" y="354" font-family="ui-sans-serif, system-ui, sans-serif" font-size="92" font-weight="900" fill="url(#accent)" letter-spacing="-2">PENGU</text>

  <!-- subtitle -->
  <text x="80" y="416" font-family="ui-sans-serif, system-ui, sans-serif" font-size="26" font-weight="500" fill="#9ab2bc">
    11 technical indicator families · real market data · on-chain payments
  </text>

  <!-- stats row -->
  <g transform="translate(80, 470)">
    <g>
      <text x="0" y="20" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#9ab2bc" letter-spacing="1.5">RSI · MACD · BOLLINGER · OBV · VWAP +7 MORE</text>
    </g>
  </g>

  <!-- penguin silhouette -->
  <g transform="translate(960, 320)">
    <circle cx="0" cy="0" r="120" fill="#07C983" fill-opacity="0.18"/>
    <circle cx="0" cy="0" r="80" fill="url(#accent)" opacity="0.85"/>
    <!-- penguin body -->
    <path d="M0 -50c20 0 36 16 36 36v64c0 6-4 12-12 12h-8v20h-32v-20h-8c-8 0-12-6-12-12v-64c0-20 16-36 36-36z" fill="#0a1418"/>
    <circle cx="-12" cy="-22" r="6" fill="#2FE6D2"/>
    <circle cx="12" cy="-22" r="6" fill="#2FE6D2"/>
    <path d="M-8 -8h16l-8 14z" fill="#2FE6D2" opacity="0.85"/>
  </g>

  <!-- footer brand -->
  <g transform="translate(80, 558)">
    <rect x="0" y="0" width="40" height="40" rx="10" fill="#07C983" fill-opacity="0.18" stroke="#07C983" stroke-opacity="0.4"/>
    <path d="M20 8c5.5 0 10 4.5 10 10v9c0 1.5-1 3-3 3h-2v5h-10v-5h-2c-2 0-3-1.5-3-3v-9c0-5.5 4.5-10 10-10z" fill="#2FE6D2"/>
    <text x="56" y="22" font-family="ui-sans-serif, system-ui, sans-serif" font-size="20" font-weight="900" fill="#f5fafc">Pengu<tspan fill="#07C983">Signals</tspan></text>
    <text x="56" y="42" font-family="ui-monospace, monospace" font-size="11" fill="#9ab2bc" letter-spacing="0.5">penguinsignals.app · daily · real · on-chain</text>
  </g>
</svg>`;

export function GET() {
  return new NextResponse(SVG, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
