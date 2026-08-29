# 🐧 PenguSignals

**سیگنال‌های هوشمند خرید و فروش PENGU روی بلاکچین Abstract — معماری v4 کاملاً بدون دیتابیس**

سکوی تحلیل تکنیکال ارز PENGU (Pudgy Penguins) که با اجرای **۵ خانواده اندیکاتور** روی **۴ تایم‌فریم زنده** (15m / 1h / 4h / 1d)، سیگنال **خرید / فروش / انتظار** با امتیاز ۰ تا ۱۰۰، سطح اطمینان، سطوح ریسک ATR و توضیح دوزبانه تولید می‌کند. ورود با کیف پول Abstract (AGW)، پرداخت با PENGU یا ETH و تأیید کامل روی زنجیره — **بدون هیچ دیتابیسی**.

---

## ✨ امکانات

| قابلیت | توضیح |
|---|---|
| 🔐 **ورود با کیف پول** | احراز هویت SIWE با امضای کیف پول — پشتیبانی از Abstract Global Wallet (اسمارت اکانت) و کیف‌های EOA از طریق ERC-6492/EIP-1271 |
| 🗄 **بدون دیتابیس** | هیچ داده‌ای ذخیره نمی‌شود: بازار زنده fetch می‌شود، دسترسی‌ها داخل session امضاشده سفر می‌کنند، پرداخت‌ها روی زنجیره راستی‌آزمایی می‌شوند و تاریخچه از کندل‌های عمومی **بازمحاسبه قطعی** می‌شود |
| 🕐 **موتور چند-تایم‌فریمی** | ۱۵ دقیقه، ۱ ساعت، ۴ ساعت و روزانه — هر تایم‌فریم امتیاز مستقل ۰-۱۰۰ می‌گیرد و سیگنال اصلی از ترکیب وزن‌دار آن‌ها ساخته می‌شود |
| 🧠 **موتور تحلیل ۵ فاکتوری** | روند EMA20/50 (۳۰٪) + مومنتوم ATR-نرمال (۲۵٪) + MACD (۲۰٪) + RSI (۱۵٪) + حجم (۱۰٪) — وزن‌دهی شفاف و قابل ممیزی، نه ۲۰ اندیکاتور |
| 💳 **پرداخت چند-توکنی روی زنجیره** | PENGU (ERC-20) یا ETH (native) به خزانه — کوت‌های HMAC-امضاشده با نرخ قفل‌شده ۳۰ دقیقه‌ای؛ تأیید کامل سمت سرور از طریق RPC رسمی Abstract |
| ⛓ **بازیابی از زنجیره** | زنجیره خودش دیتابیس است: اسکن `eth_getLogs` پرداخت‌های شما به خزانه را پیدا کرده و اشتراک را دوباره فعال می‌کند — حتی بعد از پاک کردن کوکی‌ها |
| 📈 **سابقه بازتولیدپذیر** | هر سیگنال روزگذشته از کندل‌های عمومی Binance بازمحاسبه می‌شود — هرکسی می‌تواند صحت track record را راستی‌آزمایی کند |
| 🔔 **هشدار قیمت محلی** | هشدارها در localStorage همین مرورگر ذخیره و سمت کلاینت ارزیابی می‌شوند — صفر سرور، صفر دیتابیس |
| 🌍 **دوزبانه** | فارسی (RTL) و انگلیسی — افزودن زبان جدید = افزودن یک فایل JSON |
| ⚡ **مدرن و سریع** | Next.js 16 App Router، React 19، Tailwind 4، TypeScript strict، استقرار Cloudflare Workers رایگان |

## 💳 تعرفه‌ها (مدل دسترسی v4 — طبق معماری هدف)

ثبت‌نام و مرور **رایگان** است: بازار زنده، سابقه سیگنال‌ها، پیش‌نمایش اجماع و داشبورد شخصی — بدون محتوای سیگنال. فقط سیگنال کامل نیاز به «پاس دسترسی» دارد:

| پاس | قیمت | ≈ روزانه | مدت |
|---|---|---|---|
| رایگان | **۰** | — | همیشه — ورود و مرور بدون سیگنال |
| یک‌روزه | **۱۰ PENGU** | ۱۰.۰ | ۱ روز |
| ۷ روزه | **۵۰ PENGU** | ۷.۱ | ۷ روز |
| ۳۰ روزه | **۳۰۰ PENGU** | ۱۰.۰ | ۳۰ روز |
| یک‌ساله | **۱۵۰۰ PENGU** | ۴.۱ | ۳۶۵ روز |
| مادام‌العمر | **۳۰۰۰ PENGU** | — | ∞ (دو برابر پلن سالانه) |

پاس‌ها روی هم انباشته می‌شوند (تمدید زودتر = از دست ندادن روزها). منبع واحد تعرفه: `src/lib/modules/access/passes.ts`. پرداخت با ETH هم ممکن است (تبدیل لحظه‌ای با کوت امضاشده).

## 🚀 اجرای محلی

```bash
# پیش‌نیاز: Node.js 20+ / Bun 1.1+
bun install
cp .env.example .env        # مقادیر را تنظیم کنید (حداقل SESSION_SECRET)
bun run dev                 # http://localhost:3000
```

### تست سریع API

```bash
curl http://localhost:3000/api                     # سلامت سرویس
curl http://localhost:3000/api/market/overview     # داده زنده بازار (رایگان)
curl http://localhost:3000/api/signal/preview      # پیش‌نمایش: اجماع + تایم‌فریم‌ها
curl http://localhost:3000/api/signal/history      # سابقه عمومی (بازمحاسبه قطعی)
curl http://localhost:3000/api/payment/config      # توکن‌ها + کوت‌های امضاشده
```

## 🏗 معماری v4 — Stateless

```text
User Browser (Next.js 16)
        │
        ├── AGW Login (SIWE + stateless HMAC nonce)
        ▼
Cloudflare Worker (App Router — بدون دیتابیس)
        │
        ├── Snapshot: Binance ticker → DexScreener enrich → CoinGecko → CoinMarketCap
        ├── Candles per TF: Binance klines → CoinGecko fallback
        │       (cache: 15m→30s · 1h→60s · 4h/1d→120s)
        │
        ├── Signal Engine: 5 factors × 4 timeframes → score 0-100
        │       BUY ≥75 / WAIT / SELL <25 + confidence + ATR levels
        │
        ├── History: deterministic recompute از کندل‌های عمومی (304+ روز)
        │
        └── Payments: on-chain verify → entitlement داخل session امضاشده
                └── Recovery: eth_getLogs treasury scan (زنجیره = دیتابیس)
```

```text
Database     ❌      PostgreSQL   ❌      Redis        ❌
Cloudflare Worker ✅  In-memory cache ✅  Public APIs  ✅
AGW          ✅      On-chain payment ✅ Treasury     ✅
```

```
src/
├── app/
│   ├── page.tsx                  # اپ تک‌صفحه‌ای (تنها روت کاربر)
│   └── api/
│       ├── auth/                 # nonce / verify / session (SIWE stateless)
│       ├── access/restore/       # بازیابی اشتراک از زنجیره (eth_getLogs)
│       ├── market/overview/      # داده زنده بازار (رایگان)
│       ├── signal/               # preview (رایگان) / today (پولی) / history / detail
│       ├── payment/              # config (کوت‌ها) / verify / history
│       └── me/dashboard/         # داشبورد کاربر (از session + اسکن سبک)
├── lib/
│   ├── config.ts                 # کانفیگ سرور (zod-validated، fail-fast)
│   ├── public-config.ts          # کانفیگ کلاینت (NEXT_PUBLIC_*)
│   ├── cache.ts                  # TTL cache + stale-while-revalidate
│   ├── security/
│   │   ├── session.ts            # سشن HMAC + entitlement claim (stateless)
│   │   ├── siwe.ts               # nonce خودامضاشده + تأیید امضا (EIP-1271)
│   │   └── rate-limit.ts         # محدودیت نرخ پنجره‌لغزان
│   └── modules/
│       ├── market/               # binance / dexscreener / coingecko / coinmarketcap
│       ├── analysis/             # indicators / signals (۵ فاکتور) / engine / signal-service
│       └── access/               # passes / tokens / payments / entitlements / restore
├── components/
│   ├── pengu/                    # کامپوننت‌های اپ
│   ├── i18n/                     # سیستم چندزبانه
│   └── ui/                       # shadcn/ui
└── i18n/                         # fa.json / en.json
```

جزئیات کامل: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

### 📚 فهرست مستندات

| سند | محتوا |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | معماری کل سیستم و جریان‌های اصلی |
| [SECURITY.md](docs/SECURITY.md) | مدل تهدید، سشن stateless، مدل اعتماد پرداخت |
| [API.md](docs/API.md) | مرجع کامل endpointها |
| [WALLET-AND-TRANSACTIONS.md](docs/WALLET-AND-TRANSACTIONS.md) | کیف پول/امضا/تراکنش — مبتنی بر مستندات رسمی Abstract |
| [TECH-STACK.md](docs/TECH-STACK.md) | فناوری‌ها، نسخه‌ها، دلیل انتخاب‌ها |
| [ACCESS-MODEL.md](docs/ACCESS-MODEL.md) | مدل دسترسی، تعرفه و معماری بدون دیتابیس |
| [AUDIT.md](docs/AUDIT.md) | گزارش ممیزی + نتایج QA |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | استقرار (Cloudflare Workers) |
| [BACKEND.md](docs/BACKEND.md) | راهنمای توسعه‌دهندهٔ سرور |
| [FRONTEND.md](docs/FRONTEND.md) | راهنمای توسعه‌دهندهٔ کلاینت |

## 🔒 امنیت

1. **احراز هویت بدون رمز و بدون DB** — nonce خودامضاشده (HMAC، TTL و binding داخل خود nonce) + پیام امضا‌شده + سشن HMAC با مقایسه timing-safe
2. **تأیید پرداخت روی زنجیره** — سرور خودش رسید تراکنش را از RPC رسمی Abstract می‌گیرد؛ کلاینت فقط هش می‌فرستد؛ انقضای پاس از **timestamp خود بلاک** محاسبه می‌شود (replay یک تراکنش قدیمی هرگز پاس آینده نمی‌سازد)
3. **اعتبارسنجی ورودی** — همه ورودی‌های API با zod
4. **Rate limiting** — روی همه endpoint ها (restore محدودتر چون RPC-سنگین است)
5. **Zero client trust** — هیچ تصمیم امنیتی سمت کلاینت نیست

## ☁️ استقرار روی Cloudflare (رایگان، بدون کارت اعتباری)

راهنمای کامل: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

خلاصه: Cloudflare Workers + OpenNext adapter — **بدون D1 و بدون هیچ binding دیتابیسی**. طرح رایگان Workers (۱۰۰k درخواست/روز) کاملاً کافی است.

## 📝 ثبت در Abstract Portal

برای نمایش در [portal.abs.xyz](https://portal.abs.xyz): اپ را deploy کنید، در Portal یک اپ جدید بسازید (Get Listed) و اطلاعات (نام، لوگوی پنگوئن، دسته Trading/Analytics، URL) را وارد کنید.

## 📄 مجوز

MIT — آزاد برای استفاده و توسعه.

## ⚠️ سلب مسئولیت

خروجی این سیستم تحلیل الگوریتمی داده‌های واقعی بازار است و **توصیه مالی نیست**. معامله در بازارهای دیجیتال با ریسک همراه است.
