# 🐧 PenguSignals

**سیگنال‌های هوشمند خرید و فروش PENGU روی بلاکچین Abstract**

سکوی تحلیل تکنیکال ارز PENGU (Pudgy Penguins) که هر روز با اجرای ۱۱ خانواده اندیکاتور روی داده‌های واقعی بازار، سیگنال **خرید / فروش / نگهداری** با سطح اطمینان و پلن مدیریت ریسک تولید می‌کند. ورود با کیف پول Abstract (AGW)، پرداخت با توکن PENGU و تأیید کامل روی زنجیره.

---

## ✨ امکانات

| قابلیت | توضیح |
|---|---|
| 🔐 **ورود با کیف پول** | احراز هویت SIWE با امضای کیف پول — پشتیبانی از Abstract Global Wallet (اسمارت اکانت) و کیف‌های EOA از طریق ERC-6492/EIP-1271 |
| 📊 **داده واقعی** | قیمت لحظه‌ای از DexScreener (استخر Abstract)، کندل‌های تاریخی از Binance با fallback به CoinGecko — بدون هیچ دیتای ساختگی |
| 🧠 **موتور تحلیل ۱۱_layer** | EMA، SMA، RSI، MACD، Bollinger، Stochastic، OBV، VWAP، Momentum، Volume regime، Support/Resistance — وزن‌دهی شفاف و قابل ممیزی |
| 🎯 **مدیریت ریسک** | ناحیه ورود، حد ضرر و اهداف سود مبتنی بر ATR + نسبت ریسک به ریوارد |
| 💰 **پرداخت روی زنجیره** | تأیید تراکنش ERC-20 کاملاً سمت سرور از طریق RPC رسمی Abstract — صفر اعتماد به کلاینت |
| 📈 **سابقه واقعی** | هر سیگنال ۲۴ ساعت بعد به‌صورت خودکار با قیمت واقعی ارزیابی می‌شود (WIN/LOSS) |
| 🌍 **دوزبانه** | فارسی (RTL) و انگلیسی — افزودن زبان جدید = افزودن یک فایل JSON |
| ⚡ **مدرن و سریع** | Next.js 16 App Router، React 19، Tailwind 4، TypeScript strict |

## 💳 تعرفه‌ها (مدل دسترسی v2 — بدون Session Key)

ثبت‌نام و مرور **رایگان** است: بازار زنده، سابقه سیگنال‌ها، پیش‌نمایش اجماع اندیکاتورها و داشبورد شخصی — بدون محتوای سیگنال. فقط سیگنال‌ها نیاز به «پاس دسترسی» دارند:

| پاس | قیمت | مدت |
|---|---|---|
| رایگان | **۰** | همیشه — ورود و مرور بدون سیگنال |
| یک‌روزه | **۱۰ PENGU** | ۱ روز |
| ۷ روزه | **۵ PENGU** | ۷ روز |
| ۳۰ روزه | **۳۰ PENGU** | ۳۰ روز |
| یک‌ساله | **۱۰۰ PENGU** | ۳۶۵ روز |
| مادام‌العمر | **۱۵۰۰ PENGU** | ∞ |

پاس‌ها روی هم انباشته می‌شوند (تمدید زودتر = از دست ندادن روزها). منبع واحد تعرفه: `src/lib/modules/access/passes.ts`.

پرداخت با ترانسفر معمولی ERC-20 به آدرس خزانه انجام می‌شود و **فقط هش تراکنش** به سرور ارسال می‌شود — تأیید کامل روی زنجیره Abstract و سمت سرور، بدون Session Key و بدون approval. جزئیات کامل: `docs/ACCESS-MODEL.md`.

## 🚀 اجرای محلی

```bash
# پیش‌نیاز: Node.js 20+ / Bun 1.1+
bun install
cp .env.example .env        # مقادیر را تنظیم کنید (حداقل SESSION_SECRET)
bun run db:push             # ساخت دیتابیس SQLite
bun run dev                 # http://localhost:3000
```

### تست سریع API

```bash
curl http://localhost:3000/api                     # سلامت سرویس
curl http://localhost:3000/api/market/overview     # داده زنده بازار (رایگان)
curl http://localhost:3000/api/signal/preview      # پیش‌نمایش سیگنال امروز
curl http://localhost:3000/api/signal/history      # سابقه عمومی
```

## 🏗 معماری

```
src/
├── app/
│   ├── page.tsx                  # اپ تک‌صفحه‌ای (تنها روت کاربر)
│   └── api/
│       ├── auth/                 # nonce / verify / session (SIWE)
│       ├── market/overview/      # داده زنده بازار (رایگان)
│       ├── signal/               # preview (رایگان) / today (پولی) / history
│       └── payment/              # config / verify / history
├── lib/
│   ├── config.ts                 # کانفیگ سرور (zod-validated، fail-fast)
│   ├── public-config.ts          # کانفیگ کلاینت (NEXT_PUBLIC_*)
│   ├── cache.ts                  # TTL cache + stale-while-revalidate
│   ├── logger.ts                 # لاگ ساختاریافته JSON
│   ├── security/
│   │   ├── session.ts            # کوکی‌های HMAC-SHA256 (httpOnly)
│   │   ├── siwe.ts               # nonce + ساخت پیام + تأیید امضا
│   │   └── rate-limit.ts         # محدودیت نرخ پنجره‌لغزان
│   └── modules/
│       ├── market/               # dexscreener / binance / coingecko / service
│       ├── analysis/             # indicators / signals / engine / signal-service
│       └── access/               # payments (تأیید on-chain) / entitlements
├── components/
│   ├── pengu/                    # کامپوننت‌های اپ
│   ├── i18n/                     # سیستم چندزبانه
│   └── ui/                       # shadcn/ui
└── i18n/                         # fa.json / en.json
```

جزئیات کامل: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## 🔒 امنیت

امنیت اولویت اول، دوم و سوم این پلتفرم است:

1. **احراز هویت بدون رمز** — پیام امضا‌شده با nonce یک‌بارمصرف (replay-impossible)، سشن HMAC با مقایسه timing-safe
2. **تأیید پرداخت روی زنجیره** — سرور خودش رسید تراکنش را از RPC رسمی Abstract می‌گیرد و Transfer event را پارس می‌کند؛ کلاینت فقط هش تراکنش را می‌فرستد (txHash یکتا = ضد replay، from = کیف متصل = ضد سرقت اعتبار)
3. **اعتبارسنجی ورودی** — همه ورودی‌های API با zod
4. **Rate limiting** — روی همه endpoint ها
5. **Zero client trust** — هیچ تصمیم امنیتی سمت کلاینت نیست

## ☁️ استقرار روی Cloudflare (رایگان، بدون کارت اعتباری)

راهنمای کامل: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

خلاصه: Cloudflare Workers + D1 + OpenNext adapter. طرح رایگان Workers (۱۰۰k درخواست/روز) + D1 (۵GB) برای این پروژه کاملاً کافی است.

## 📝 ثبت در Abstract Portal

برای نمایش در [portal.abs.xyz](https://portal.abs.xyz):

1. اپ را deploy کنید و دامنه HTTPS آماده کنید
2. در Portal یک اپ جدید بسازید (Get Listed)
3. اطلاعات: نام، توضیح، لوگو (ماسکات پنگوئن)، دسته‌بندی (Trading/Analytics)، URL
4. برای دسترسی به Grant های Abstract، از [مستندات builders](https://abs.xyz) پیروی کنید

## 📄 مجوز

MIT — آزاد برای استفاده و توسعه.

## ⚠️ سلب مسئولیت

خروجی این سیستم تحلیل الگوریتمی داده‌های واقعی بازار است و **توصیه مالی نیست**. معامله در بازارهای دیجیتال با ریسک همراه است.
