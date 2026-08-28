# Access Model (v2) — Session-Key-Free

> Status: **active** since 2026-08 · Owner decision: stay OUTSIDE Abstract's
> session-key review policies. This document is the contract between product,
> code and docs. If the model changes, update this file in the same commit.

## 1. Tariff

| Tier | Product ID | Price (PENGU) | Duration |
|---|---|---:|---|
| Free | — | 0 | forever (browse-only) |
| Day | `PASS_1D` | 10 | 1 day |
| Week | `PASS_7D` | 5 | 7 days |
| Month | `PASS_30D` | 30 | 30 days |
| Year | `PASS_365D` | 100 | 365 days |
| Lifetime | `PASS_LIFETIME` | 1500 | ∞ (≈100 years, stored as a grant) |

**Single source of truth:** `src/lib/modules/access/passes.ts` — imported by
both server (verification, grants) and client (pricing grid). Changing a
price or adding a tier is a one-file edit; no env vars, no duplication.

**What the free tier includes:** wallet registration (SIWE-style signature
auth), entry, live market data, the signal *preview* (indicator consensus
counts only — no action, no levels), the public track record, and the
personal dashboard. **Signal content is never part of the free tier.**

**What every pass unlocks:** the same thing — the full daily signal
(action, entry zone, stop-loss, take-profits, reasoning, factor breakdown,
alert creation). Passes differ ONLY in duration.

**Stacking:** a new pass extends from the later of *(now, current expiry)* —
users never lose paid days by renewing early. Implemented in
`lib/modules/access/payments.ts → verifyAndCredit()`.

## 2. Payment flow (no session keys, by design)

```
User picks a pass
   → wallet sends a plain ERC-20 `transfer(treasury, price)` on Abstract
   → client submits ONLY the tx hash to POST /api/payment/verify
   → server verifies against its own RPC:
        1. receipt exists, status == success
        2. Transfer log: token == PENGU, to == treasury,
           from == authenticated wallet, value >= price
        3. tx hash never credited before (replay protection)
   → on success: Payment row + AccessGrant created atomically (DB transaction)
```

Why no session keys:

- **No approval/allowance is ever requested** from the user's wallet —
  only standard `transfer()` calls the user signs themselves.
- Session keys on Abstract currently go through extra review/audit
  policies; plain transfers are trustless and require none of that.
- Nothing is lost security-wise: the client never claims payment, the
  server verifies everything on-chain against its own RPC.

## 3. Content protection ("no access without a pass")

All gating is **server-side**; the client only renders what the server sends:

| Endpoint | Gate | Non-entitled response |
|---|---|---|
| `GET /api/signal/today` | session + active pass | `402 PAYMENT_REQUIRED` — signal body never serialized |
| `GET /api/signal/preview` | none (rate-limited) | consensus counts only; action/confidence/levels/reasoning are `null` server-side |
| `GET /api/signal/history` | public track record | past day/action/outcome pairs (performance proof — by design); entry/TP/SL levels and reasoning are never included, and today's signal is never in the list |
| `GET /api/me/dashboard` | session | per-user financial data only |
| `POST /api/payment/verify` | session + rate limit | — |
| `POST /api/alerts` | session (free-tier feature — market data, not signal content) | — |

Additional hardening already in place: per-IP sliding-window rate limits on
every route, single-use nonces for auth, HMAC session cookies, tx-hash
uniqueness enforced twice (pre-check + inside the DB transaction).

## 4. Legacy migration (v1 → v2)

v1 products (`PLATFORM_ACCESS`, `DAY_PASS`, `SUB_7`, `SUB_30`) no longer
exist. Old `Payment` rows keep their original product ids and render with
"(legacy)" labels in the dashboard. Users who held v1 platform access and
had no grants received a one-time 30-day `LEGACY_PLATFORM` grant via
`scripts/migrate-legacy-access.ts` (idempotent — safe to re-run).

## 5. Future: adding session keys (deliberately deferred)

The architecture is session-key-ready without containing any session-key
code:

- **Crediting is centralized** in `verifyAndCredit(txHash, user, product)` —
  a future autopay only needs to produce a qualifying transfer and call the
  same pipeline; grants, stacking and replay protection stay identical.
- **Suggested future flow** (when product wants it):
  1. user creates an AGW session key with a spend policy
     (max X PENGU/day, only PENGU token, only our treasury, expiry N days);
  2. our backend detects the pass expiry approaching and requests an
     auto-renewal transfer through the session key;
  3. the resulting tx goes through the same `verifyAndCredit` verification —
     the trust model is unchanged because verification is on-chain.
- Nothing in the current schema needs to change (`Payment.product` is a
  free-form string; grants are duration-based).

## 6. Pricing rationale note

The week pass (5 PENGU) is intentionally the cheapest *total* entry point —
a deliberate hook so new users pick it over the 1-day pass. Per-day value
decreases monotonically from there: 0.71 → 1 → 0.27 → ∞-bounded. If the
product owner ever wants a different ladder, edit `passes.ts` only.
