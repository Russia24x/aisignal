# PenguSignals — Worklog

## Project Overview
PenguSignals: A modern minimal PENGU (Pudgy Penguins) trading signal platform built on Abstract Chain (Ethereum L2, chain ID 2741).
- Auth: Abstract Global Wallet (AGW) signature-based sessions (SIWE-style)
- Engine: real technical analysis (RSI, MACD, EMA, SMA, Bollinger, Stochastic, ATR, OBV, VWAP, pivots) from live market data
- Monetization: platform access 5 PENGU (one-time), day pass 1 PENGU, subscription packs 1 PENGU/day (7/30 days)
- Treasury (env-driven): 0x60Df4E186364c3a49A550Aee29Da1d5fe3658818
- Data: DexScreener (live snapshot) + CoinGecko (historical OHLC), no API keys needed
- PENGU token on Abstract (verified via RPC eth_call): 0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62, 18 decimals, symbol PENGU
- Abstract mainnet: chainId 2741, RPC https://api.mainnet.abs.xyz, explorer https://abscan.org

---
Task ID: 1
Agent: main
Task: Research Abstract docs + PENGU token + data sources

Work Log:
- Read https://docs.abs.xyz llms.txt index + key pages (connect-to-abstract, AGW native integration, session keys, provider, login hook)
- Verified PENGU on Abstract via DexScreener search + RPC eth_call (decimals=18)
- Verified CoinGecko OHLC API works for pudgy-penguins
- Decision: session keys require mainnet security review → subscription = prepaid packs (1 PENGU/day), documented upgrade path
- Installed @abstract-foundation/agw-react@1.13.0, wagmi@3.7.7, viem@2.56.0

Stage Summary:
- All external facts verified. Architecture decided: modular monolith, env-driven config, Prisma+SQLite locally, D1 migration path documented for Cloudflare.

---
Task ID: 2
Agent: main
Task: Build complete PenguSignals platform (core + frontend + docs)

Work Log:
- Config system: src/lib/config.ts (zod-validated server env), src/lib/public-config.ts (client-safe)
- DB schema (Prisma/SQLite): User, Nonce, AuthSession, Payment, AccessGrant, Signal, EngineSnapshot — pushed successfully
- Security: HMAC session cookies (timing-safe), SIWE auth with server-built messages, sliding-window rate limiter, zod validation everywhere
- Market module: DexScreener (live Abstract pair), Binance klines (primary history, USD volumes), CoinGecko (fallback + cross-check), TTL cache with stale-while-revalidate
- Analysis engine: 11 indicator families (EMA/SMA/RSI/MACD/BB/Stoch/OBV/VWAP/Momentum/Volume/SR) with weights summing to 100, ATR-based risk levels (1.2/1.8/3.0 ATR), bilingual reasoning generation, deterministic per-UTC-day signal storage
- API routes: /api/auth/{nonce,verify,session}, /api/market/overview, /api/signal/{preview,today,history}, /api/payment/{config,verify,history}, /api (health)
- Frontend: single-page app with Header (live price pill, lang switch FA/EN RTL), Hero (AI-generated penguin mascot + real stats), PriceChart (recharts 90d/48h), SignalSection (state machine gates + full signal card with factor bars), PricingSection (4 products), TrackRecord, EngineSection, FAQ, sticky Footer
- i18n: useSyncExternalStore-based context, fa.json + en.json, RTL/LTR switching
- Docs: README.md (fa), docs/ARCHITECTURE.md, docs/DEPLOYMENT.md (Cloudflare Workers + D1 + OpenNext, free tier)
- E2E tests (all 10 passed): nonce→sign→verify→session, replay blocked, bad-sig rejected, paywall enforced (402), payment error paths
- E2E payment test with REAL on-chain txs: verified 22.09 PENGU transfer (0x72dc8397…) → PLATFORM_ACCESS credited; replay + wrong-payer + mint-tx all rejected correctly
- Browser QA (agent-browser): page renders with real data, VLM UI review 9/10 desktop, 8/10 mobile, no console errors, sticky footer verified, language switch works, chart tabs work

Stage Summary:
- Platform fully functional: real engine output (today: BUY score 31.6 conf 43%), real on-chain payment verification proven with live transactions
- Site owner wallet 0x5138fb70799738534717d9bf7226d73c6233d95b has PLATFORM_ACCESS from their real 22 PENGU payment
- Lint + tsc clean

---
Task ID: 3
Agent: main
Task: Final QA + cron setup + consensus bar RTL fix

Work Log:
- Fixed consensus bar label alignment (labels now dir="ltr" matching the bar segments)
- Created 15-min recurring webDevReview cron job (id: 342025, fixed_rate 900s)
- Final verification: lint clean, tsc clean, HTTP 200, zero console/page errors, zero errors in dev.log
- Signal for 2026-08-28 live: BUY, score +31.6, confidence 43%, 6/11 bullish factors

Stage Summary:
- Phase 1 COMPLETE: platform is fully functional and verified end-to-end with real data + real on-chain payments
- Next-phase candidates (for the recurring review agent): add signal email/telegram notifications, per-user signal history page, KV-based distributed rate limiting for Cloudflare, SEO/OG meta images, WebSocket live price ticker, session-key autopay research
