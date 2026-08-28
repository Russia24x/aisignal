# Task 5-b — full-stack-developer — Per-user "My Dashboard" section

## What was built
A per-user dashboard section visible only to authenticated users who hold platform
access (paid the 5 PENGU one-time tariff). Sits between the Signal section and
the Pricing section. Renders `null` for everyone else (visitors and
connected-but-not-paid users), so the existing page flow is unchanged for them.

## Files created
1. `src/app/api/me/dashboard/route.ts` — GET-only API route.
   - Rate-limited via existing `guard(req, "signal")` (RATE_LIMIT_SIGNAL group).
   - Uses existing `getSession()` from `@/lib/security/session` for auth → 401 if no session.
   - Uses existing `getEntitlements()` from `@/lib/modules/access/entitlements` for the platform-access gate → 403 if no platform access.
   - Uses existing `db` Prisma client to fetch active AccessGrant (with startsAt for progress math), last 5 verified Payments, total-spent aggregate, and user.platformAccessAt — all in parallel via Promise.all.
   - Computes daysLeft, totalDays, progressPercent server-side.
   - Returns `{ ok, dashboard: { entitlements, activeGrant, payments, platformAccessAt, daysLeft, totalSpentPengu } }` with `cache-control: no-store` header + `export const dynamic = "force-dynamic"`.
   - Pattern mirrors `/api/payment/history/route.ts` (auth) and `/api/signal/today/route.ts` (platform-access gate).

2. `src/components/pengu/MyDashboard.tsx` — 'use client' component.
   - useQuery from `@tanstack/react-query` with `enabled = entitlements?.authenticated && entitlements?.platformAccess`.
   - Returns `null` when not enabled (invisible for visitors / connected-but-not-paid).
   - Sticky section header (`top-16 z-30`, sits just below the main nav) with Sparkles icon, title, subtitle, short-address Badge (with full-address Tooltip), and a Refresh button calling `queryClient.invalidateQueries({ queryKey: ["me-dashboard"] })`.
   - 4-card grid (`sm:grid-cols-2 lg:grid-cols-4`) of glass-cards:
     1. Subscription status: Active/Expired badge (buy-green vs muted), grant product name, expiresAt locale-formatted, Progress bar with `daysLeft/totalDays` label.
     2. Platform access: ✅ check icon, "Lifetime" badge, "Since: <date>" locale-formatted.
     3. Total spent: large mono number (text-primary, 3xl, font-black) + "PENGU" suffix.
     4. Recent payments: `max-h-40 nice-scroll` list of last 5, each row = colored amount (text-primary), product Badge, short tx-hash link to `publicConfig.explorerUrl` + ExternalLink icon + full-hash Tooltip, relative-time `<time>` (Intl.RelativeTimeFormat, fa-IR/en-US) with full-datetime Tooltip; empty state with History icon + noPayments copy.
   - Skeleton placeholders per card during loading.
   - RTL-aware (dir="ltr" on numeric/hash lists, locale-aware date/time via Intl).

## Files modified (i18n only — added `dashboard.*` section, 16 keys each)
- `src/i18n/en.json`
- `src/i18n/fa.json` (natural Persian, not machine-literal)

Keys: title, subtitle, subscription, active, expired, expiresAt, daysLeft,
platformAccess, lifetime, since, totalSpent, recentPayments, noPayments,
notAvailable, refresh, loading.

## What was NOT touched (per constraints)
- `src/app/page.tsx` (main agent wires the component here)
- `src/app/layout.tsx`
- `src/components/providers.tsx`
- `prisma/schema.prisma`
- existing `src/components/pengu/*` components
- existing API routes (only created a NEW one at `/api/me/dashboard`)

## Integration point for main agent
In `src/app/page.tsx`, add the import and insert `<MyDashboard />` between
`<SignalSection />` and `<PricingSection />`:

```tsx
import { MyDashboard } from "@/components/pengu/MyDashboard";
// ...
<main className="flex-1">
  <Hero />
  <PriceChart />
  <SignalSection />
  <MyDashboard />      {/* NEW — between Signal and Pricing */}
  <PricingSection />
  <TrackRecord />
  <EngineSection />
  <FaqSection />
</main>
```

Safe for all visitors: the component returns `null` when the user is not
authenticated or doesn't have platform access, so the section is invisible for
visitors / connected-but-not-paid users — the existing page flow stays the same.

## Verification
- `bun run lint` → clean (no warnings/errors).
- `bunx tsc --noEmit 2>&1 | grep -E "src/(app/api/me|components/pengu/MyDashboard)"` → empty (no TS errors in new files).
- `curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/me/dashboard` → **HTTP 401** with body `{"ok":false,"error":"UNAUTHORIZED"}`.
  - Verified by starting a temporary `bun run dev` instance (the system's dev server was down at the time, no process listening on :3000), curling, then killing the temp instance and confirming port 3000 is free for the system to restart its own.
  - The 403 (no platform access) and 200 (authenticated + platform access) paths follow the exact same guard pattern as the existing `/api/signal/today/route.ts` — logic verified by inspection.

## Environmental note
The system's auto dev server was down during my work (no process on :3000 for
~5 min, Caddy returned 502). This is independent of my changes — when I started
a temp dev server, the homepage returned 200 and my new route returned 401
cleanly, proving my files compile and serve without breaking anything. The main
agent may need to wait for the system to restart its dev server for preview.
