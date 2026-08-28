# استقرار روی Cloudflare — ساده، کامل رایگان، بدون کارت اعتباری

این پروژه از قبل برای استقرار روی **Cloudflare Workers + D1** آماده شده است؛
نیازی به تغییر هیچ فایلی در کد نیست. فقط مراحل زیر را دنبال کنید.

## همه‌چیز رایگان است — بدون کارت اعتباری

| سرویس | طرح رایگان | نیاز پروژه | کارت اعتباری |
|---|---|---|---|
| Workers | ۱۰۰,۰۰۰ درخواست/روز | ✅ بسیار کافی | ❌ لازم نیست |
| D1 (دیتابیس SQLite) | ۵GB + ۵M ردیف خوانده‌شده/روز | ✅ برای سال‌ها کافی | ❌ لازم نیست |
| دامنه `*.workers.dev` | نامحدود + SSL خودکار | ✅ | ❌ لازم نیست |

> هیچ سرویس پولی (Vercel Pro، Turso، Upstash، Redis و…) لازم نیست.
> منابع دادهٔ بازار (DexScreener / CoinGecko / RPC ابسترکت) هم بدون کلید و رایگان‌اند.

## چه چیزهایی از قبل آماده شده؟

- `wrangler.jsonc` — تنظیمات کامل Worker (فقط `database_id` را جایگزین کنید)
- `open-next.config.ts` — آداپتر رسمی OpenNext برای Cloudflare
- `src/lib/db.ts` — به‌صورت خودکار روی Workers از D1 و به‌صورت محلی از SQLite استفاده می‌کند
- `prisma/schema.prisma` — `driverAdapters` فعال است (سازگار با D1)
- اسکریپت‌های `npm run preview` و `npm run deploy` در `package.json`
- سوییچ `NEXT_PUBLIC_TICKER_WS` — حالت REST برای پروداکشن (توضیح در گام ۵)

## گام ۰ — پیش‌نیازها

- حساب Cloudflare رایگان: [dash.cloudflare.com](https://dash.cloudflare.com) (فقط ایمیل)
- Node.js 20+ (یا Bun)

## گام ۱ — نصب وابستگی‌ها و ورود

```bash
npm install          # یا: bun install
npx wrangler login   # مرورگر باز می‌شود — بدون نیاز به کارت
```

`@opennextjs/cloudflare` و `wrangler` از قبل در `package.json` هستند.

## گام ۲ — ساخت دیتابیس D1 (رایگان)

```bash
npx wrangler d1 create pengu-signals
```

خروجی یک `database_id` می‌دهد. آن را در `wrangler.jsonc` جایگزین کنید:

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "pengu-signals",
  "database_id": "<اینجا بگذارید>"
}]
```

## گام ۳ — ساخت جداول در D1

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > schema.sql
npx wrangler d1 execute pengu-signals --remote --file=schema.sql
```

> بعد از هر تغییر `schema.prisma` همین دو دستور را دوباره اجرا کنید.

## گام ۴ — سِکرت نشست

```bash
openssl rand -hex 32                     # یک مقدار تصادفی بسازید
npx wrangler secret put SESSION_SECRET   # مقدار بالا را پیست کنید
```

> `SESSION_SECRET` هرگز در `wrangler.jsonc` یا `.env` کامیت‌شده قرار نمی‌گیرد.

## گام ۵ — حالت پروداکشن تیکر (REST)

سرویس socket.io (`mini-services/ws-ticker`) فقط برای توسعهٔ محلی است و روی
Workers اجرا نمی‌شود. قبل از build، در فایل `.env` (یا `.env.production`) قرار دهید:

```bash
NEXT_PUBLIC_TICKER_WS=off
```

در این حالت LiveTicker به‌طور خودکار از دادهٔ REST با تازگی ~۶۰ ثانیه
(`/api/market/overview` با کش سرور) استفاده می‌کند — بدون هیچ خطا یا تلاش ناموفق
برای اتصال سوکت. (برای توسعهٔ محلی دوباره `on` بگذارید یا خط را حذف کنید.)

بقیهٔ متغیرهای `.env` نمونهٔ `.env.example` را ببینید؛ مقادیر `NEXT_PUBLIC_*`
مهم نیستند چون در زمان build از `.env` خوانده و داخل باندل قرار می‌گیرند، و
مقادیر سمت سرور (TTLها، rate limitها و…) از قبل به‌صورت پیش‌فرض معقول در
`wrangler.jsonc` → `vars` تنظیم شده‌اند.

## گام ۶ — تست محلی روی runtime واقعی Workers (اختیاری)

```bash
npm run preview
```

اپ روی `http://localhost:8787` با runtime ورکر اجرا می‌شود — دقیقاً همان
محیطی که در پروداکشن خواهد بود.

## گام ۷ — استقرار پروداکشن

```bash
npm run deploy
```

خروجی آدرس نهایی را می‌دهد: `https://pengu-signals.<زیردامنه>.workers.dev`
(SSL خودکار و رایگان).

## گام ۸ — دامنه سفارشی (اختیاری، رایگان)

اگر دامنه‌ای در همین حساب Cloudflare دارید:
داشبورد → Workers & Pages → `pengu-signals` → Settings → Domains & Routes →
Add → Custom Domain. SSL خودکار فعال می‌شود.

## چک‌لیست امنیتی قبل از رفتن زنده

- [ ] `SESSION_SECRET` جدید و ۳۲+ کاراکتری تنظیم شده (گام ۴)
- [ ] آدرس خزانه و توکن PENGU با `eth_call` روی RPC راستی‌آزمایی شده
- [ ] دیتابیس D1 با `schema.sql` ساخته شده (گام ۳)
- [ ] `NEXT_PUBLIC_TICKER_WS=off` هنگام build فعال بوده (گام ۵)
- [ ] Cloudflare WAF / Rate Limiting رایگان برای `/api/auth/*` و `/api/payment/*`
      در داشبورد فعال شده (اختیاری اما توصیه‌شده)
- [ ] لاگ‌ها را در داشبورد → Workers → Observability بررسی کنید

## نکته‌های معماری

1. **محدودیت نرخ درون‌حافظه‌ای**: روی Workers هر isolate شمارندهٔ خودش را دارد
   (تقریبی اما مؤثر). برای دقت بالاتر می‌توان بعداً Cloudflare Rate Limiting
   یا KV اضافه کرد — هر دو رایگان؛ فعلاً لازم نیست.
2. **کش بازار**: همان TTLCache درون isolate کار می‌کند و `/api/market/overview`
   با TTL ۶۰ ثانیه از منابع بالادستی محافظت می‌کند.
3. **بدون R2**: کش ISR توزیع‌شدهٔ اختیاری است و فعال نشده تا استقرار ساده بماند.
   اگر لازم شد: [opennext.js.org/cloudflare/caching](https://opennext.js.org/cloudflare/caching)
4. **توسعهٔ محلی**: دقیقاً مثل قبل — `bun run dev` روی پورت ۳۰۰۰ با SQLite؛
   `db.ts` به‌طور خودکار مسیر محلی را انتخاب می‌کند.
