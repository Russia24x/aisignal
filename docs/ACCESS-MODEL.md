# مدل دسترسی و معماری بدون دیتابیس — v4

## چرا بدون دیتابیس؟

معماری هدف صریح است: **«هیچ دیتایی را دائمی ذخیره نمی‌کنیم»**. نتیجه:

```text
Database ❌  PostgreSQL ❌  Supabase ❌  Firebase ❌  Redis ❌  D1 ❌
Cloudflare Worker ✅  In-memory Cache ✅  AGW ✅  Public APIs ✅  Treasury ✅
```

هر قابلیت سابق، جایگزین stateless خودش را دارد:

| نیاز | راه‌حل v3 (DB) | راه‌حل v4 (بدون DB) |
|---|---|---|
| nonce یک‌بارمصرف | جدول Nonce | nonce خودامضاشده (HMAC) + burn حافظه‌ای |
| هویت کاربر | جدول User | آدرس کیف پول = هویت (session.sub) |
| ثبت پرداخت / ضد replay | جدول Payment (txHash یکتا) | timestamp بلاک برای انقضا — replay بی‌فایده است |
| دسترسی زمان‌دار | جدول AccessGrant | claim `ent` داخل session امضاشده |
| سابقه سیگنال + Track record | جدول Signal | بازمحاسبه قطعی از کندل‌های عمومی |
| هشدار قیمت | جدول PriceAlert | localStorage کلاینت |
| بازگشت کاربر پولی | SELECT از جداول | اسکن eth_getLogs زنجیره |

## تعرفه v4 (طبق §8 معماری هدف)

منبع واحد: `src/lib/modules/access/passes.ts` (مشترک بین کلاینت و سرور — قیمت در کد است، نه در DB).

| پاس | قیمت (PENGU) | مدت | ≈ روزانه |
|---|---|---|---|
| PASS_1D | ۱۰ | ۱ روز | ۱۰.۰ |
| PASS_7D | ۵۰ | ۷ روز | ۷.۱ |
| PASS_30D | ۳۰۰ | ۳۰ روز | ۱۰.۰ |
| PASS_365D | ۱٬۵۰۰ | ۳۶۵ روز | ۴.۱ |
| PASS_LIFETIME | ۳٬۰۰۰ | ∞ | — (۲× سالانه) |

## توکن‌های پرداخت (§7 معماری هدف)

رجیستری: `src/lib/modules/access/tokens.ts`

| توکن | نوع | Decimals | وضعیت |
|---|---|---|---|
| PENGU | ERC-20 روی Abstract | ۱۸ | ✅ فعال — ارز محصول، مبناى قیمت‌گذاری |
| ETH | native | ۱۸ | ✅ فعال — کوت HMAC-امضاشده با نرخ قفل ۳۰ دقیقه |
| USDC.e | ERC-20 روی Abstract | ۶ | ⛔ ثبت‌شده، غیرفعال (نقدینگی on-chain کم؛ بعد از تأیید فعالش کنید) |

- **PENGU:** ترانسفر دقیق به خزانه؛ سرور مقدار را با کاتالوگ مطابقت می‌دهد
- **ETH:** `/api/payment/config` کوت امضاشده برمی‌گرداند (`product|token|amountRaw|quotedAt` زیر HMAC)؛ verify با تحمل ۳٪ اسلیپیج نسبت به کوت
- **انقضای پاس از timestamp بلاک** محاسبه می‌شود؛ replay تراکنش قدیمی پاس منقضی می‌دهد، نه آینده

## جریان خرید

```
۱. GET /api/payment/config        ← توکن‌ها + کوت‌های امضاشده (per plan/token)
۲. کاربر از کیف پول خودش (AGW) تراکنش می‌فرستد:
     PENGU: transfer(treasury, price)
     ETH:   sendTransaction(to=treasury, value=quoted)
۳. POST /api/payment/verify {txHash, product, quote?}
     سرور: receipt از RPC رسمی + همه بررسی‌ها (§SECURITY)
۴. entitlement داخل session جدید مینت می‌شود ← همه سکشن‌ها reactive آپدیت می‌شوند
```

- **مسیر دستی** («قبلاً پرداخت کرده‌اید؟»): فقط PENGU — هش تراکنش را بچسبانید؛ چون from باید با کیف سشن یکی باشد، فقط برای همان کیف پول کار می‌کند
- **Stacking:** پلن جدید از `max(انقضای فعلی, blockTime)` شروع می‌شود — تمدید زودهنگام روزها را هدر نمی‌دهد

## بازیابی اشتراک از زنجیره (§9)

`POST /api/access/restore` — زنجیره خودش دیتابیس است:

1. اسکن چانکی `eth_getLogs` (پیش‌فرض ۴۰۰ روز، چانک‌های ۴M بلاکی) برای `Transfer(token, from=کیف شما, to=خزانه)`
2. هر پرداخت → بزرگ‌ترین پلن قابل خرید (`passForAmount`)
3. بازپخش زمانی: `exp = max(exp, blockTime) + days` — دقیقاً همان چیزی که موقع پرداخت مینت می‌شد
4. بهترین entitlement داخل سشن مینت می‌شود (فقط اگر بهتر از سشن فعلی باشد)

- بعد از هر **signIn** یکبار در پس‌زمینه اجرا می‌شود
- دکمه «بازیابی خریدها» در داشبورد هم همین را صدا می‌زند
- محدودیت: تراکنش native ETH لاگ ندارد → ETH فقط با هش دستی قابل بازیابی است (ضد replay با انقضای block-timestamp)
- کش per-wallet ده‌دقیقه‌ای + rate-limit جداگانه (۶ درخواست / ۵ دقیقه)

## لایه‌های محصول (§17 معماری هدف)

```
Layer 1 — Market    : Binance → DexScreener (enrich) → CoinGecko → CoinMarketCap
Layer 2 — Intelligence : ۵ فاکتور × ۴ تایم‌فریم → score 0-100 → BUY/SELL/WAIT
Layer 3 — Blockchain : AGW + پرداخت on-chain + خزانه + بازیابی + تأیید
```

## چیزهایی که عمداً ساخته نمی‌شود (§18)

سیگنال on-chain ، trading bot ، معامله خودکار، مدیریت پرتفوی، چت، بک‌آفیس سنگین — همه پیچیدگی بی‌جهت می‌آورند. زنجیره فقط برای Identity / Payment / Access / Treasury / Verification استفاده می‌شود (§20).
