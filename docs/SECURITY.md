# امنیت PenguSignals — مدل کامل

این سند مدل تهدید، لایه‌های دفاعی و تصمیمات امنیتی پروژه را به‌صورت کامل مستند می‌کند. خلاصهٔ مدیریتی در پایین سند است.

---

## ۱. اصول کلیدی

1. **صفر اعتماد به کلاینت** — هر ادعایی (امضا، پرداخت) فقط در سرور و فقط با دادهٔ زنجیره راستی‌آزمایی می‌شود.
2. **کلیدها هرگز از کیف پول خارج نمی‌شوند** — ما هیچ private key/seed ای نگه نمی‌داریم؛ هویت = مالکیتِ اثبات‌شدهٔ آدرس.
3. **گیتِ محتوا فقط سمت سرور** — سیگنال روز فقط از API با سشنِ دارای پاس فعال برمی‌گردد؛ ماسک‌کردن در UI تزئین نیست، لایهٔ دفاع نیست — **لایهٔ دفاع، 402/401 در سرور است**.
4. **یک منبع حقیقت برای قیمت‌ها** — کاتالوگ پاس‌ها (`passes.ts`) بین سرور و کلاینت مشترک است ولی **سرور** موقع verify از آن استفاده می‌کند؛ مقدار ارسالی کلاینت مبنای اعتباردهی نیست.

---

## ۲. مدل احراز هویت (SIWE رسمی EIP-4361 روی Abstract)

> کاملاً منطبق با کامپوننت رسمی SIWE Abstract (build.abs.xyz/docs/authentication/siwe-button) — با تقویت‌های اضافی.

### جریان
1. `GET /api/auth/nonce?address=…` → nonce رسمی `generateSiweNonce()` (viem/siwe، ۹۶ کاراکتر)، **یک‌بارمصرف**، TTL ۱۰ دقیقه، اختیاریِ مقید به آدرس + پیام EIP-4361 ساخته‌شده با `createSiweMessage()` (سمت سرور — کلاینت فقط رله است)
2. کاربر با AGW امضا می‌کند (امضای EIP-1271 اسمارت‌اکانت) — فقط از کلیک (popup-blocker safety)
3. `POST /api/auth/verify { message, signature }` (شکل رسمی) → سرور:
   - `parseSiweMessage()` + `validateSiweMessage()` (توابع رسمی viem/siwe)
   - **اعتبارسنجی Chain ID**: `siwe.chainId === 2741` وگرنه `INVALID_CHAIN`
   - **اعتبارسنجی Domain (ضد replay بین‌دامنه‌ای)**: دامنهٔ پیام ∈ {APP_URL host، Host درخواست} وگرنه `INVALID_DOMAIN`
   - **اعتبارسنجی Expiration Time**: پیام منقضی/طولانی نشده باشد (`MESSAGE_EXPIRED`)
   - اعتبار nonce در DB (وجود/مصرف‌نشدن/انقضا/تطابق آدرس) — سخت‌گیرانه‌تر از نمونهٔ رسمی (session-cookie)
   - `verifySiweMessage({ blockTag: 'latest' })` با viem مقابل **آدرس اسمارت‌اکانت** — EIP-1271 برای اکانت مستقر، ERC-6492 برای اکانت استقرارنیافته (الگوی رسمی Abstract)
   - burn اتمیک nonce (updateMany با شرط `usedAt: null` → replay غیرممکن)
4. کوکی سشن HMAC → `httpOnly` + `sameSite=lax` + `secure` در production + TTL ۱۶۸ ساعت

### توکن سشن
```
pengu_session = base64url(JSON payload) . base64url(HMAC-SHA256(payload))
payload = { sub, addr, iat, exp, jti }
```
- مقایسهٔ امضا **timing-safe** (`timingSafeEqual`)
- payload شامل نقش/ادعایی نیست؛ همهٔ entitlements هر بار از DB خوانده می‌شوند (بدون stale privilege)

### امضای AGW چرا این‌طور راستی‌آزمایی می‌شود؟
امضای AGW ساختار EIP-712 (`AGWMessage(bytes32)`) + کدگذاری validator دارد و برای اکانت‌های استقرارنیافته ERC-6492-wrapped است؛ بنابراین ecRecover ساده همیشه نتیجهٔ غلط می‌داد. `verifySiweMessage` رسمی viem این سه حالت را خودش هندل می‌کند. جزئیات: `docs/WALLET-AND-TRANSACTIONS.md §4`.

---

## ۳. مدل اعتماد پرداخت (Session-Key-Free)

**خلاصهٔ تصمیم:** پرداخت = ترانسفر معمولی ERC-20 (بدون `approve`، بدون allowance، بدون Session Key). این تصمیم عمداً خارج از سیاست‌های بازبینی Session Key رسمی Abstract نگه داشته شده.

### خط لولهٔ verify (`src/lib/modules/access/payments.ts`)
| مرحله | کنترل | خطا |
|---|---|---|
| ۱ | فرمت هش `/^0x[0-9a-f]{64}$/` | `INVALID_TX_HASH` |
| ۲ | پاس معتبر در کاتالوگ سرور | `UNKNOWN_PRODUCT` |
| ۳ | هش قبلاً استفاده نشده (پیش + داخل تراکنش DB) | `TX_ALREADY_USED` |
| ۴ | رسید موجود؟ (pending → 202 / ناموجود → 404) | `TX_PENDING` / `TX_NOT_FOUND` |
| ۵ | `status === "success"` | `TX_FAILED` |
| ۶ | لاگ Transfer با token == PENGU، to == خزانه، from == آدرس سشن، value ≥ قیمت | `NO_QUALIFYING_TRANSFER` |
| ۷ | ثبت Payment + AccessGrant در یک `$transaction` | اتمیک |

### تهدیدهای پوشش‌داده‌شده
- **جعل پرداخت**: کلاینت فقط هش می‌فرستد؛ همهٔ فیلدها از خود زنجیره خوانده می‌شود
- **Replay** (استفادهٔ دوباره از یک تراکنش): unique constraint روی `Payment.txHash` + بررسی دوباره داخل تراکنش
- **پرداخت از کیف پول دیگران**: `from` باید با `session.addr` یکی باشد
- **کم‌پردازی**: `value ≥ toBaseUnits(expectedPrice)` — قیمت از کاتالوگ سرور نه کلاینت
- **مسیر مخفی/بدون سشن**: بدون کوکی معتبر → 401
- **شنیدن مبلغ از کلاینت**: بدنهٔ درخواست فقط `product.id` است؛ قیمت از کاتالوگ سرور lookup می‌شود

### نهایی‌بودن (Finality)
رسید موفق L2 = soft confirmation (عرف اکوسیستم برای مبالغ خرد)؛ نهایی‌بودن کامل پس از executeBatches روی L1. اگر روزی مبالغ بزرگ/حساس شد، پایش batch (zks_L1BatchNumber) قابل افزودن است.

---

## ۴. گیت محتوا (Content Gating)

| endpoint | بدون سشن | سشنِ رایگان | پاس فعال |
|---|---|---|---|
| `GET /api/signal/preview` (اجماع ماسک‌شده) | ✅ | ✅ | ✅ |
| `GET /api/signal/history` (سابقه — **بدون سیگنال امروز**) | ✅ | ✅ | ✅ |
| `GET /api/signal/today` | 401 | 402 `NEED_ACCESS_PASS` | ✅ کامل |
| `GET /api/market/overview` | ✅ | ✅ | ✅ |
| `GET /api/me/dashboard` | 401 | ✅ | ✅ |
| `POST /api/payment/verify` | 401 | ✅ (منجر به اعتباردهی) | ✅ |
| `POST/GET/DELETE /api/alerts*` | 401 | ✅ | ✅ |

**نشتِ تاریخیِ برطرف‌شده**: قبلاً `signal/history` سیگنال *امروز* را هم در سابقهٔ عمومی برمی‌گرداند (اکشن امروزِ رایگان قابل خواندن بود) → با شرط `day < today` رفع شد. سابقه همچنان کارایی گذشته را اثبات می‌کند ولی محتوای امروز فقط پشت گیت است.

---

## ۵. Rate Limiting

محدودساز پنجرهٔ لغزانِ درون‌حافظه (`src/lib/security/rate-limit.ts`) با سقف حافظهٔ ۱۰هزار کلید و پاک‌سازی دوره‌ای. IP از `cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`.

| bucket | حد | مصرف‌کننده |
|---|---|---|
| `auth` | ۳۰/دقیقه | nonce + verify (هر ورود = ۲ hit؛ پشت گیت‌وی همه یک IP هستند) |
| `payment` | ۱۰/دقیقه | verify پرداخت |
| `signal` | ۳۰/دقیقه | signal/today و ... |
| `public` | ۱۲۰/دقیقه | session/market/profile (هر بار لود صفحه ≈ ۱۰ درخواست) |

پاسخ 429 شامل `retry-after` ثانیه‌ای است. کلاینت خطای `RATE_LIMITED` را به پیام بومی‌سازی‌شده تبدیل می‌کند (رفع باگ ورودِ دورهٔ قبل — دیگر ورود بلاک نمی‌شود).

---

## ۶. حملات موردی و دفاع‌ها

| تهدید | دفاع |
|---|---|
| CSRF روی متدهای تغییردهنده | کوکی `sameSite=lax` (cross-site POST کوکی نمی‌فرستد)؛ GETها بدون اثر جانبی؛ POSTها فقط عملیاتِ خودِ کاربرِ سشن‌دار |
| XSS → سرقت سشن | کوکی httpOnly (JS به آن دسترسی ندارد)؛ بدون `dangerouslySetInnerHTML` برای ورودی کاربر |
| Brute-force امضا | nonce یک‌بارمصرف + rate limit auth + verifyMessage خودِ زنجیره |
| Enumeration آدرس‌ها | آدرس‌ها کلید عمومی زنجیره‌اند؛ IP فقط به‌صورت هش‌شده (SHA-256 + salt سشن) نگه‌داری می‌شود |
| Payload جعلی در verify | اعتبارسنجی zod روی همهٔ بدنه‌ها (`z.object` + regex) |
| خطای ۵۰۰ با اطلاعات حساس | Logger سمت سرور؛ پاسخ‌های خطا فقط کد پایدار برمی‌گردانند |
| Secretها در باندل کلاینت | تفکیک `config.ts` (سرور) از `public-config.ts` (فقط NEXT_PUBLIC_*)؛ zod fail-fast |
| DB race در اعتباردهی | `$transaction` + بررسی دوبارهٔ یکتایی هش داخل تراکنش |

---

## ۷. مدیریت Secret و Environment

- `SESSION_SECRET` (≥۳۲ کاراکتر) — کلید HMAC سشن و salt هش IP
- همهٔ پیکربندی هنگام لود ماژول با zod اعتبارسنجی می‌شود (invalid → crash اولیه، نه رفتار undefined در runtime)
- `.env` در git نیست؛ الگو در `.env.example`
- آدرس‌های قرارداد/خزانه فقط به‌صورت public config (اصل امنیتی: عمومی‌اند، امنیت از راستی‌آزمایی زنجیره می‌آید نه پنهان‌کاری)

---

## ۸. محدودیت‌های شناخته‌شده (صداقت کامل)

1. **Rate limiter درون‌حافظه است** → در استقرار multi-instance، هر isolate پنجرهٔ خودش را دارد (برای Cloudflare Workers باید به Rate Limiting binding مهاجرت شود — مستند در DEPLOYMENT.md)
2. **Sessionها stateless هستند** → revoke فوری همهٔ سشن‌ها = تغییر SESSION_SECRET (فهرست revoke جانبی وجود ندارد)
3. **Finality نرم برای اعتباردهی** — برای مبالغ خرد عرف است؛ پایش L1 در نقشهٔ راه
4. **تیکر قیمت** کاملاً REST است (poll ۶۰ ثانیه با کش سرور) — هیچ سرویس سوکت/زیرساخت اضافه‌ای برای استقرار لازم نیست
5. امضای پیام (برخلاف تراکنش) در AGW popup باز می‌کند — مطابق الگوی رسمی Abstract فقط از کلیک کاربر فراخوانی می‌شود (نه از effect خودکار) تا popup blocker مرورگر آن را مسدود نکند؛ در حالت بلاک شدن نیز پیام خطای دقیق (`POPUP_BLOCKED`) و دکمهٔ تلاش مجدد ارائه می‌شود

---

## ۹. خلاصهٔ مدیریتی

- احراز هویت: **امضای کیف پول + nonce یک‌بارمصرف + راستی‌آزمایی on-chain (EIP-1271/ERC-6492)** — بدون رمز، بدون third-party auth
- سشن: **کوکی HMAC httpOnly** با TTL ۷ روز
- پرداخت: **ترانسفر مستقیم ERC-20 + راستی‌آزمایی کامل سرور از RPC رسمی Abstract** — بدون Session Key، بدون approval، بدون نگهداری رمز
- محتوا: **گیت سرور** با 401/402؛ نشت تاریخی رفع شده
- سوءاستفاده: **rate limit پنجرهٔ لغزان** روی ۱۴ endpoint + retry-after
- کلیدها: فقط در کیف پول کاربر؛ ما هیچ کلیدی نگه نمی‌داریم
