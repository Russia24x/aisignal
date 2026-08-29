# استقرار روی Cloudflare — ساده، کامل رایگان، بدون کارت اعتباری

این پروژه از قبل برای استقرار روی **Cloudflare Workers** آماده شده است — **بدون هیچ دیتابیس و binding دیتایی**.
نیازی به تغییر هیچ فایلی در کد نیست. فقط مراحل زیر را دنبال کنید.

## همه‌چیز رایگان است — بدون کارت اعتباری

| سرویس | طرح رایگان | نیاز پروژه | کارت اعتباری |
|---|---|---|---|
| Workers | ۱۰۰,۰۰۰ درخواست/روز | ✅ بسیار کافی | ❌ لازم نیست |
| دامنه `*.workers.dev` | نامحدود + SSL خودکار | ✅ | ❌ لازم نیست |

> هیچ سرویس پولی (Vercel Pro، Turso، Upstash، Redis و…) لازم نیست — **هیچ دیتابیسی هم لازم نیست** (v4 stateless).
> منابع دادهٔ بازار (Binance / DexScreener / CoinGecko / CoinMarketCap / RPC ابسترکت) هم بدون کلید و رایگان‌اند.

## چه چیزهایی از قبل آماده شده؟

- `wrangler.jsonc` — تنظیمات کامل Worker (فقط `APP_URL` را با آدرس نهایی جایگزین کنید)
- `open-next.config.ts` — آداپتر رسمی OpenNext برای Cloudflare
- **صفر دیتابیس** — کش‌ها درون‌حافظه‌ای‌اند؛ entitlements داخل سشن امضاشده؛ تاریخچه از کندل‌های عمومی بازمحاسبه می‌شود؛ پرداخت‌ها روی زنجیره راستی‌آزمایی می‌شوند
- اسکریپت‌های `npm run preview` و `npm run deploy` در `package.json`
- تیکر قیمت با حالت واحد REST (~۶۰ ثانیه، کش سرور) — روی sandbox و Workers
  یکسان کار می‌کند؛ هیچ سرویس سوکتی وجود ندارد و هیچ تنظیمی لازم نیست

## گام ۰ — پیش‌نیازها

- حساب Cloudflare رایگان: [dash.cloudflare.com](https://dash.cloudflare.com) (فقط ایمیل)
- Node.js 20+ (یا Bun)

## گام ۱ — نصب وابستگی‌ها و ورود

```bash
npm install          # یا: bun install
npx wrangler login   # مرورگر باز می‌شود — بدون نیاز به کارت
```

`@opennextjs/cloudflare` و `wrangler` از قبل در `package.json` هستند.

## گام ۲ — سِکرت نشست

```bash
openssl rand -hex 32                     # یک مقدار تصادفی بسازید
npx wrangler secret put SESSION_SECRET   # مقدار بالا را پیست کنید
```

> `SESSION_SECRET` هرگز در `wrangler.jsonc` یا `.env` کامیت‌شده قرار نمی‌گیرد.
> این کلید HMAC سشن‌ها، nonceها و کوت‌های پرداخت است.

## گام ۳ — متغیرهای محیطی

در `wrangler.jsonc` → `vars` مقدار `APP_URL` را با آدرس نهایی (مثلاً
`https://pengu-signals.<زیردامنه>.workers.dev`) به‌روز کنید — دامنه در پیام SIWE
چک می‌شود. بقیهٔ متغیرها پیش‌فرض معقول دارند؛ فهرست کامل با توضیح در `.env.example`.

## گام ۴ — تست محلی روی runtime واقعی Workers (اختیاری)

```bash
npm run preview
```

اپ روی `http://localhost:8787` با runtime ورکر اجرا می‌شود — دقیقاً همان
محیطی که در پروداکشن خواهد بود.

## گام ۵ — استقرار پروداکشن

```bash
npm run deploy
```

خروجی آدرس نهایی را می‌دهد: `https://pengu-signals.<زیردامنه>.workers.dev`
(SSL خودکار و رایگان). اگر `APP_URL` را بعد از دیپلوی فهمیدید، به‌روز کنید و یکبار دیگر deploy بزنید.

## گام ۶ — دامنه سفارشی (اختیاری، رایگان)

اگر دامنه‌ای در همین حساب Cloudflare دارید:
داشبورد → Workers & Pages → `pengu-signals` → Settings → Domains & Routes →
Add → Custom Domain. SSL خودکار فعال می‌شود.

## چک‌لیست امنیتی قبل از رفتن زنده

- [ ] `SESSION_SECRET` جدید و ۳۲+ کاراکتری تنظیم شده (گام ۲)
- [ ] `APP_URL` در `wrangler.jsonc` با آدرس نهایی یکی است (اعتبارسنجی دامنهٔ SIWE)
- [ ] آدرس خزانه و توکن PENGU با `eth_call` روی RPC راستی‌آزمایی شده
- [ ] یک تراکنش واقعی کوچک (PASS_1D) را end-to-end تست کرده‌اید: پرداخت → verify → فعال‌شدن سیگنال → restore
- [ ] Cloudflare WAF / Rate Limiting رایگان برای `/api/auth/*` و `/api/payment/*`
      در داشبورد فعال شده (اختیاری اما توصیه‌شده)
- [ ] لاگ‌ها را در داشبورد → Workers → Observability بررسی کنید

## نکته‌های معماری (v4 stateless)

1. **بدون D1/KV/R2** — هیچ binding دیتایی وجود ندارد؛ state فقط در کش‌های TTL درون isolate است
2. **محدودیت نرخ درون‌حافظه‌ای**: روی Workers هر isolate شمارندهٔ خودش را دارد
   (تقریبی اما مؤثر). برای دقت بالاتر می‌توان بعداً Cloudflare Rate Limiting
   اضافه کرد — رایگان؛ فعلاً لازم نیست.
3. **کش بازار و سیگنال**: همان TTLCache درون isolate کار می‌کند —
   snapshot با TTL ۶۰s، کندل‌ها per-TF با نردبان 30s/60s/120s/120s (§13 معماری هدف)،
   تاریخچه با TTL ۱۵ دقیقه. ۱۰۰۰ کاربر ≠ ۱۰۰۰ درخواست upstream.
4. **restore**: اسکن `eth_getLogs` چانکی روی Workers هم کار می‌کند (فقط fetch به RPC)؛
   کش per-wallet ده‌دقیقه‌ای + rate-limit جداگانه از هزینهٔ RPC محافظت می‌کند.
5. **توسعهٔ محلی**: `bun run dev` روی پورت ۳۰۰۰ — همان کد، همان رفتار، صفر تنظیم اضافه.
