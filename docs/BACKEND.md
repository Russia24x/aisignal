# بک‌اند PenguSignals — راهنمای توسعه‌دهنده

ساختار کامل سمت سرور: ماژول‌ها، سرویس‌ها، جریان‌های داده، پیکربندی و عملیات.

```
src/
├── app/api/            ← ۱۴ endpoint (App Router route handlers)
│   ├── auth/           nonce · verify · session
│   ├── payment/verify  راستی‌آزمایی on-chain
│   ├── signal/         today · preview · history
│   ├── market/overview snapshot زنده
│   ├── me/dashboard    داشبورد کاربر
│   ├── alerts/         CRUD هشدار قیمت
│   ├── user-profile/   پروفایل پرتال Abstract (پروکسی cache)
│   └── og              تصویر OG
├── lib/
│   ├── config.ts       پیکربندی سرور (zod fail-fast)
│   ├── public-config.ts مقادیر عمومی کلاینت
│   ├── db.ts           Prisma client singleton
│   ├── cache.ts        TTLCache (stale-while-revalidate)
│   ├── logger.ts       logger ساخت‌یافته سمت سرور
│   ├── security/       siwe · session · rate-limit
│   └── modules/
│       ├── market/     service (snapshot) · coingecko (fallback تاریخ)
│       ├── analysis/   engine · indicators · signals · signal-service
│       ├── access/     passes (تعرفه) · entitlements · payments
│       └── alerts/     checker
└── app/route.ts        health-check سرویس
mini-services/ws-ticker/ سرویس socket.io (پورت ۳۰۳۳)
prisma/schema.prisma    مدل داده
```

---

## الگوی ثابت هر Route Handler

```ts
export async function POST(req: NextRequest) {
  const limited = guard(req, "bucket");        // 1) rate limit → 429
  if (limited) return limited;
  const session = await getSession();          // 2) احراز هویت (در صورت نیاز)
  const parsed = schema.safeParse(body);       // 3) اعتبارسنجی zod
  // 4) منطق از ماژول دامنه (بدون منطق در route)
  // 5) پاسخ { ok: true, … } یا { ok: false, error: "CODE" } + status درست
}
```

---

## ماژول دسترسی (`lib/modules/access/`)

- **`passes.ts`** — منبع واحد تعرفه (قیمت‌ها + تخفیف‌ها + متادیتا). هم کلاینت (گرید قیمت) و هم سرور (verify) از آن می‌خوانند. تغییر قیمت = فقط این فایل.
  - مبنای ۱۰ PENGU/روز، پلکان ۰/۱۰/۲۰/۳۰٪ (سقف ۳۰٪)، LIFETIME = 2× سالانه
- **`entitlements.ts`** — `getEntitlements(userId)`: محاسبهٔ signalAccess از AccessGrantهای فعال + `productCatalog()` برای سرور
- **`payments.ts`** — خط لولهٔ `verifyAndCredit` (۷ مرحله + تراکنش اتمیک). شرح کامل: `SECURITY.md §3`

## ماژول تحلیل (`lib/modules/analysis/`)

- **`indicators.ts`** — پیاده‌سازی خالص: SMA/EMA/RSI/MACD/Bollinger/Stochastic/ATR/OBV/VWAP/Momentum/S-R
- **`signals.ts`** — `computeFactors`: وزن‌دهی ۱۱ خانواده + بافت S/R و ATR
- **`engine.ts`** — `runEngine(input)`: جمع‌بندی وزنی → اکشن BUY/SELL/HOLD + confidence + entry zone/SL/TP (ATR-based) + reasoning + dataQuality
- **`signal-service.ts`**:
  - `getOrCreateTodaySignal()` — idempotent (کلید یکتای `day` UTC)؛ ورودی از ماژول بازار + snapshot در `EngineSnapshot` برای ممیزی
  - `evaluateOpenSignals()` — ارزیابی WIN/LOSS سیگنال‌های باز با قیمت فعلی
  - `getSignalHistory(limit)` — فقط روزهای گذشته (`day < today`)

## ماژول بازار (`lib/modules/market/`)

- **`service.ts`** — `getSnapshot()` (DexScreener، TTL 60s، stale-while-revalidate) + `getHistory()` (Binance 90d daily + 48h hourly؛ fallback CoinGecko)
- **`coingecko.ts`** — fetch تاریخ + قیمت ساده؛ cross-check قیمت فقط هر ۱۰مین refresh (throttle منابع)
- نکتهٔ معماری: cache **on-demand** است — بدون بازدید، صفر فراخوانی upstream

## ماژول هشدار (`lib/modules/alerts/`)

- `checkAlerts(priceUsd)` — با هر snapshot فعال شدن هشدارها را علامت می‌زند (فعلاً in-app؛ ارسال پیام در نقشهٔ راه)

---

## سرویس ws-ticker (mini-service)

- پورت مستقل ۳۰۳۳، socket.io، ورود از مرورگر: `io("/?XTransformPort=3033")` (گیت‌وی Caddy)
- polling تطبیقی: ۱۵s وقتی کلاینت متصل، ۶۰s idle (صرفه‌جویی ۷۵٪ درخواست)
- transport: polling-first (درس‌آموخته از محیط sandbox؛ websocket-first باعث reconnect-loop از پشت گیت‌وی می‌شد)
- **فقط توسعهٔ محلی** — روی Cloudflare Workers اجرا نمی‌شود؛ در پروداکشن
  `NEXT_PUBLIC_TICKER_WS=off` را تنظیم کنید و LiveTicker به‌طور خودکار از
  REST با کش ۶۰ ثانیه‌ای (`/api/market/overview`) استفاده می‌کند (بدون
  Durable Objects و بدون هزینه). مستند در DEPLOYMENT.md

## پیکربندی (`.env`)

| کلید | پیش‌فرض | توضیح |
|---|---|---|
| `SESSION_SECRET` | — (الزامی ≥۳۲) | HMAC سشن + salt هش IP |
| `APP_URL` | localhost:3000 | دامنهٔ پیام امضا |
| `DATABASE_URL` | file:./db/custom.db | SQLite |
| `NEXT_PUBLIC_RPC_URL` | api.mainnet.abs.xyz | RPC رسمی Abstract |
| `NEXT_PUBLIC_CHAIN_ID` | 2741 | — |
| `NEXT_PUBLIC_PENGU_TOKEN` | 0x9eBe…Ba62 | توکن PENGU (۱۸ اعشار) |
| `NEXT_PUBLIC_TREASURY` | 0x60Df…8818 | خزانهٔ پرداخت |
| `NEXT_PUBLIC_EXPLORER_URL` | abscan.org | — |
| `RATE_LIMIT_*` | 30/10/30/120 در دقیقه | auth/payment/signal/public |
| `SESSION_TTL_HOURS` | 168 | عمر کوکی سشن |
| `MARKET_CACHE_TTL_MS` و… | — | TTLهای داده |

همه با zod در `config.ts` اعتبارسنجی می‌شوند — مقدار غلط = خطای بوت، نه رفتار خاموش.

## عملیات

- **migrate دسترسی قدیم**: `scripts/migrate-legacy-access.ts` — فقط برای DB محلی قدیمی؛ اسکریپت sandbox-محلی است و در مخزن نیست (دیپلوی تازه با DB خالی شروع می‌شود و نیازی به آن ندارد)
- **health**: `GET /api` → `{ ok, service, time }`
- **لاگ‌ها**: ساخت‌یافته با context (auth/payments/market)؛ سطح از `LOG_LEVEL`
