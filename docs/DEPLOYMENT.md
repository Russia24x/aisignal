# استقرار روی Cloudflare (طرح رایگان — بدون کارت اعتباری)

این راهنما اپ را روی **Cloudflare Workers + D1** اجرا می‌کند؛ زیرساخت کاملاً رایگان در حد طرح Free:

| منبع | سهم رایگان | نیاز این پروژه |
|---|---|---|
| Workers | ۱۰۰,۰۰۰ درخواست/روز | ✅ بسیار کافی |
| D1 (SQLite) | ۵GB + ۵M ردیف/خوانده‌شده در روز | ✅ کافی برای سال‌ها |
| KV | ۱۰۰k خواندن/روز | اختیاری (کش توزیع‌شده) |

## گام ۰ — پیش‌نیازها

- حساب Cloudflare رایگان ([dash.cloudflare.com](https://dash.cloudflare.com)) — فقط ایمیل
- Node.js 20+ و npm

## گام ۱ — نصب ابزارها

```bash
npm install -g wrangler
wrangler login          # مرورگر باز می‌شود؛ بدون کارت اعتباری
npm install @opennextjs/cloudflare
```

## گام ۲ — ساخت دیتابیس D1

```bash
wrangler d1 create pengu-signals
# خروجی: database_id = xxxx-xxxx
```

در فایل `wrangler.toml` (ریشه پروژه):

```toml
name = "pengu-signals"
main = ".open-next/worker.js"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "pengu-signals"
database_id = "<از خروجی بالا>"

[vars]
NEXT_PUBLIC_APP_NAME = "PenguSignals"
NEXT_PUBLIC_CHAIN_ID = "2741"
NEXT_PUBLIC_RPC_URL = "https://api.mainnet.abs.xyz"
NEXT_PUBLIC_EXPLORER_URL = "https://abscan.org"
NEXT_PUBLIC_PENGU_TOKEN = "0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62"
NEXT_PUBLIC_TREASURY = "0x60Df4E186364c3a49A550Aee29Da1d5fe3658818"
# Tariff lives in src/lib/modules/access/passes.ts (no env vars needed).
# After first v2 deploy, run once: bun scripts/migrate-legacy-access.ts
MARKET_CACHE_TTL_MS = "60000"
HISTORY_CACHE_TTL_MS = "900000"
RATE_LIMIT_PUBLIC = "60/60000"
NEXT_PUBLIC_DEFAULT_LOCALE = "fa"
NEXT_PUBLIC_SUPPORTED_LOCALES = "fa,en"
```

> ⚠️ `SESSION_SECRET` را در `vars` نگذارید؛ در گام ۴ به‌صورت secret ذخیره می‌شود.

## گام ۳ — مهاجرت Prisma به D1

دیتابیس لایه‌ی جداشده است (فقط `src/lib/db.ts` + `schema.prisma`):

1. در `schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

2. نصب آداپتر:

```bash
npm install @prisma/adapter-d1
npx prisma generate
```

3. در `src/lib/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

const adapter = new PrismaD1((process.env as any).DB);
export const db = new PrismaClient({ adapter });
```

4. ساخت جداول در D1:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > schema.sql
wrangler d1 execute pengu-signals --remote --file=schema.sql
```

> نکته: `bun run db:push` فقط برای SQLite محلی است؛ برای D1 همیشه از `migrate diff` + `d1 execute` استفاده کنید.

## گام ۴ — سِکرت‌ها

```bash
wrangler secret put SESSION_SECRET     # خروجی openssl rand -hex 32
```

## گام ۵ — Build و Deploy

در `package.json` اضافه کنید:

```json
{
  "scripts": {
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
  }
}
```

سپس:

```bash
npm run preview    # تست محلی روی runtime ورکر
npm run deploy     # استقرار production
```

اپ روی `https://pengu-signals.<subdomain>.workers.dev` در دسترس است.

## گام ۶ — دامنه سفارشی (اختیاری، رایگان)

در داشبورد Cloudflare → Workers → Custom Domains → دامنه‌ای که در همان حساب است را متصل کنید. SSL خودکار و رایگان است.

## گام ۷ — امنیت production

چک‌لیست قبل از رفتن زنده:

- [ ] `SESSION_SECRET` جدید و ۳۲+ کاراکتری (`openssl rand -hex 32`)
- [ ] `NODE_ENV=production` (OpenNext خودش تنظیم می‌کند)
- [ ] آدرس خزانه و توکن PENGU را re-verify کنید (`eth_call` روی RPC)
- [ ] Rate limit ها را طبق ترافیک واقعی تنظیم کنید
- [ ] Cloudflare WAF/Rate Limiting rules برای `/api/auth` و `/api/payment` فعال کنید (رایگان)
- [ ] لاگ‌ها را در Workers Observability بررسی کنید

## نکته‌های مهم

1. **Rate limit درون‌حافظه‌ای**: هر isolate ورکر شمارنده خودش را دارد. برای دقت بالاتر، Cloudflare Rate Limiting binding یا KV را وصل کنید. برای این مقیاس، فیلتر per-isolate + CF WAF کافی است.
2. **کش بازار**: همان TTLCache درون isolate کار می‌کند؛ با KV می‌توان کش توزیع‌شده اضافه کرد (اختیاری).
3. **پورت ۳۰۰۰ محلی**: برای توسعه محلی همان `bun run dev` (SQLite) استفاده کنید؛ تغییرات D1 فقط برای deploy لازم است.
4. **Session keys (پرداخت خودکار واقعی)**: اگر خواستید اشتراک «شارژ خودکار روزانه» بدون پیش‌پرداخت اضافه کنید، مسیر رسمی Abstract session keys است که در mainnet نیاز به security review و ثبت در Session Key Policy Registry دارد. ساختار ماژولار `modules/access` برای این ارتقا آماده است.
