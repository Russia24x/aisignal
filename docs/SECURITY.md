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
1. `GET /api/auth/nonce?address=…` → nonce رسمی اما **خودامضاشده (stateless)**: `v1<random48hex><ts-hex><hmac64hex>` — کاملاً الفبایی‌عددی (الزام ABNF استاندارد EIP-4361)، TTL ۱۰ دقیقه و binding آدرس **داخل خود MAC** (بدون هیچ جدولی) + پیام EIP-4361 ساخته‌شده با `createSiweMessage()` (سمت سرور — کلاینت فقط رله است)
2. کاربر با AGW امضا می‌کند (امضای EIP-1271 اسمارت‌اکانت) — فقط از کلیک (popup-blocker safety)
3. `POST /api/auth/verify { message, signature }` (شکل رسمی) → سرور:
   - `parseSiweMessage()` + `validateSiweMessage()` (توابع رسمی viem/siwe)
   - **اعتبارسنجی Chain ID**: `siwe.chainId === 2741` وگرنه `INVALID_CHAIN`
   - **اعتبارسنجی Domain (ضد replay بین‌دامنه‌ای)**: دامنهٔ پیام ∈ {APP_URL host، Host درخواست} وگرنه `INVALID_DOMAIN`
   - **اعتبارسنجی Expiration Time**: پیام منقضی/طولانی نشده باشد (`MESSAGE_EXPIRED`)
   - **اعتبارسنجی HMAC nonce** (issuance توسط خود ما + TTL + binding آدرس — جایگزین جدول Nonce) — سخت‌گیرانه‌تر از نمونهٔ رسمی (session-cookie)
   - `verifySiweMessage({ blockTag: 'latest' })` با viem مقابل **آدرس اسمارت‌اکانت** — EIP-1271 برای اکانت مستقر، ERC-6492 برای اکانت استقرارنیافته (الگوی رسمی Abstract)
   - burn nonce در حافظهٔ isolate (best-effort — تحلیل صادقانه در پایین)
4. سشن دو حالته (dual-mode):
   - **کوکی** `pengu_session` → `httpOnly` + SameSite تطبیقی (`None; Secure` روی HTTPS تا در iframe‌های cross-site هم ذخیره شود، `Lax` در dev محلی) + TTL ۱۶۸ ساعت
   - **Bearer fallback** → همان توکن HMAC-امضاشده در پاسخ `/api/auth/verify` برگردانده می‌شود؛ کلاینت در localStorage نگه می‌دارد و با هدر `Authorization: Bearer` می‌فرستد. برای مرورگرهایی که کوکی شخص ثالث را کلاً مسدود می‌کنند (Safari / Chrome 3P phase-out) و اپ داخل iframe پنل پیش‌نمایش اجرا می‌شود
   - هر دو مسیر **یک verify یکسان** (HMAC + timing-safe) دارند — مسیر ضعیف‌تری وجود ندارد؛ `/api/auth/session` فیلد `sessionMode` را برای عیب‌یابی برمی‌گرداند

### توکن سشن
```
pengu_session = base64url(JSON payload) . base64url(HMAC-SHA256(payload))
payload = { sub, addr, iat, exp, jti, ent? }
```
- مقایسهٔ امضا **timing-safe** (`timingSafeEqual`)
- `sub == addr` — هویت همان آدرس کیف پول است (بدون جدول User)
- `ent` (اختیاری): claim مالکیت پاس ({product, expiresAt, lifetime, txHash, mintedAt}) که فقط بعد از verify موفق پرداخت یا بازیابی زنجیره مینت می‌شود؛ جعل آن بدون SESSION_SECRET ناممکن است و با انقضای پاس طبیعتاً منقضی می‌شود (بدون stale privilege)
- خروج (logout): کوکی سمت سرور پاک + توکن localStorage سمت کلاینت پاک می‌شود (توکن stateless تا انقضای exp معتبر است — همان الگوی استاندارد SIWE+JWT)

### امضای AGW چرا این‌طور راستی‌آزمایی می‌شود؟
امضای AGW ساختار EIP-712 (`AGWMessage(bytes32)`) + کدگذاری validator دارد و برای اکانت‌های استقرارنیافته ERC-6492-wrapped است؛ بنابراین ecRecover ساده همیشه نتیجهٔ غلط می‌داد. `verifySiweMessage` رسمی viem این سه حالت را خودش هندل می‌کند. جزئیات: `docs/WALLET-AND-TRANSACTIONS.md §4`.

---

## ۳. مدل اعتماد پرداخت (Session-Key-Free، Stateless)

**خلاصهٔ تصمیم:** پرداخت = ترانسفر معمولی ERC-20 (PENGU) یا ترانسفر native (ETH) به خزانه — بدون `approve`، بدون allowance، بدون Session Key. هیچ ردیفی در هیچ جدولی ثبت نمی‌شود؛ **زنجیره خودش رسید است**.

### خط لولهٔ verify (`src/lib/modules/access/payments.ts`)
| مرحله | کنترل | خطا |
|---|---|---|
| ۱ | فرمت هش `/^0x[0-9a-f]{64}$/` | `INVALID_TX_HASH` |
| ۲ | پاس معتبر در کاتالوگ سرور | `UNKNOWN_PRODUCT` |
| ۳ | رسید موجود؟ (pending → 202 / ناموجود → 404) | `TX_PENDING` / `TX_NOT_FOUND` |
| ۴ | `status === "success"` | `TX_FAILED` |
| ۵ | ERC-20: لاگ Transfer با token ∈ registry، to == خزانه، from == آدرس سشن — یا native: tx.to == خزانه و from == سشن | `NO_QUALIFYING_TRANSFER` |
| ۶ | مبلغ: PENGU → دقیقاً ≥ قیمت کاتالوگ؛ ETH → ≥ کوت امضاشده × (۱−۳٪) | `INSUFFICIENT_AMOUNT` / `QUOTE_*` |
| ۷ | مینت entitlement از **timestamp بلاک** (max(انقضای فعلی, blockTime) + مدت) | اتمیک (session جایگزین) |

### تهدیدهای پوشش‌داده‌شده
- **جعل پرداخت**: کلاینت فقط هش می‌فرستد؛ همهٔ فیلدها از خود زنجیره خوانده می‌شود
- **Replay** (استفادهٔ دوباره از یک تراکنش) — دو لایه:
  1. **انقضا از timestamp بلاک محاسبه می‌شود** نه زمان verify → replay تراکنش قدیمی فقط پاسِ همان دوره را برمی‌گرداند که خودش منقضی شده است؛ replay بین کاربران هم ناممکن است چون `from` باید با کیف سشن یکی باشد
  2. **گارد `paidAt` در claim** (v4.1): claim فعلی، timestamp بلاک *جدیدترین پرداخت مصرف‌شده* را نگه می‌دارد و `verifyPayment` پرداختی را فقط وقتی می‌پذیرد که *قطعاً جدیدتر* از `paidAt` claim فعال باشد (یا هش آن با claim فعلی یکی نباشد) → تکرار همان tx هنگام فعال بودن پاس، به‌جای انباشت (`expiry + days` در هر replay)، خطای `TX_ALREADY_USED` می‌گیرد. بدون این لایه، replay یک پرداخت ۱۰ PENGU می‌توانست پاس را بی‌نهایت تمدید کند
- **پرداخت از کیف پول دیگران**: `from` باید با `session.addr` یکی باشد
- **کم‌پردازی**: قیمت از کاتالوگ سرور؛ برای ETH کوت HMAC-امضاشده (قفل ۳۰ دقیقه‌ای، مقید به همان product/token) ملاک است
- **جعل کوت**: `QUOTE_INVALID` — MAC دوباره محاسبه می‌شود
- **مسیر مخفی/بدون سشن**: بدون کوکی معتبر → 401

### بازیابی از زنجیره (جایگزین جدول‌ها)
`POST /api/access/restore` با `eth_getLogs` چانکی (تاپیک‌فیلترشده، پیش‌فرض ۴۰۰ روز، کش per-wallet ۱۰ دقیقه، rate-limit ۶/۵ دقیقه) پرداخت‌های کاربر به خزانه را بازپخش می‌کند (`exp = max(exp, blockTime) + days`). محدودیت صادقانه: تراکنش native ETH لاگ ندارد → بازیابی ETH فقط از مسیر هش دستی (که به‌خاطر انقضای block-timestamp ضد replay است).

### نهایی‌بودن (Finality)
رسید موفق L2 = soft confirmation (عرف اکوسیستم برای مبالغ خرد)؛ نهایی‌بودن کامل پس از executeBatches روی L1. اگر روزی مبالغ بزرگ/حساس شد، پایش batch (zks_L1BatchNumber) قابل افزودن است.

---

## ۴. گیت محتوا (Content Gating)

| endpoint | بدون سشن | سشنِ رایگان | پاس فعال |
|---|---|---|---|
| `GET /api/signal/preview` (اجماع + تایم‌فریم‌ها) | ✅ | ✅ | ✅ |
| `GET /api/signal/history` (سابقه — **بدون سیگنال امروز**) | ✅ | ✅ | ✅ |
| `GET /api/signal/detail?day=` (فقط روزهای گذشته) | ✅ | ✅ | ✅ |
| `GET /api/signal/today` | 401 | 402 `PAYMENT_REQUIRED` | ✅ کامل |
| `GET /api/market/overview` | ✅ | ✅ | ✅ |
| `GET /api/me/dashboard` | 401 | ✅ | ✅ |
| `POST /api/payment/verify` | 401 | ✅ (منجر به مینت) | ✅ |
| `POST /api/access/restore` | 401 | ✅ | ✅ |

**نشتِ تاریخیِ برطرف‌شده**: قبلاً `signal/history` سیگنال *امروز* را هم در سابقهٔ عمومی برمی‌گرداند (اکشن امروزِ رایگان قابل خواندن بود) → با شرط `day < today` رفع شد. سابقه همچنان کارایی گذشته را اثبات می‌کند ولی محتوای امروز فقط پشت گیت است.

---

## ۵. Rate Limiting

محدودساز پنجرهٔ لغزانِ درون‌حافظه (`src/lib/security/rate-limit.ts`) با سقف حافظهٔ ۱۰هزار کلید و پاک‌سازی دوره‌ای. IP از `cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`.

| bucket | حد | مصرف‌کننده |
|---|---|---|
| `auth` | ۳۰/دقیقه | nonce + verify (هر ورود = ۲ hit؛ پشت گیت‌وی همه یک IP هستند) |
| `payment` | ۱۰/دقیقه | verify پرداخت + تاریخچه |
| `signal` | ۳۰/دقیقه | signal/today و ... |
| `public` | ۱۲۰/دقیقه | session/market/profile (هر بار لود صفحه ≈ ۱۰ درخواست) |
| `restore` | ۶/۵دقیقه | اسکن eth_getLogs (RPC-سنگین — کش per-wallet ده‌دقیقه‌ای) |

پاسخ 429 شامل `retry-after` ثانیه‌ای است. کلاینت خطای `RATE_LIMITED` را به پیام بومی‌سازی‌شده تبدیل می‌کند (رفع باگ ورودِ دورهٔ قبل — دیگر ورود بلاک نمی‌شود).

---

## ۶. حملات موردی و دفاع‌ها

| تهدید | دفاع |
|---|---|
| CSRF روی متدهای تغییردهنده | کوکی `sameSite=lax` (cross-site POST کوکی نمی‌فرستد)؛ GETها بدون اثر جانبی؛ POSTها فقط عملیاتِ خودِ کاربرِ سشن‌دار |
| XSS → سرقت سشن | کوکی httpOnly (JS به آن دسترسی ندارد)؛ بدون `dangerouslySetInnerHTML` برای ورودی کاربر |
| Brute-force امضا | nonce خودامضاشده (TTL + binding داخل MAC) + burn حافظه‌ای + rate limit auth + verifyMessage خودِ زنجیره |
| Enumeration آدرس‌ها | آدرس‌ها کلید عمومی زنجیره‌اند؛ هیچ دادهٔ IP اصلاً ذخیره نمی‌شود (بدون DB) |
| Payload جعلی در verify | اعتبارسنجی zod روی همهٔ بدنه‌ها (`z.object` + regex) |
| خطای ۵۰۰ با اطلاعات حساس | Logger سمت سرور؛ پاسخ‌های خطا فقط کد پایدار برمی‌گردانند |
| Secretها در باندل کلاینت | تفکیک `config.ts` (سرور) از `public-config.ts` (فقط NEXT_PUBLIC_*)؛ zod fail-fast |
| DB race در اعتباردهی | بدون DB؛ مینت entitlement یک عملیات امضای stateless است (اصلاً race ندارد) |

---

## ۷. مدیریت Secret و Environment

- `SESSION_SECRET` (≥۳۲ کاراکتر) — کلید HMAC سشن و salt هش IP
- همهٔ پیکربندی هنگام لود ماژول با zod اعتبارسنجی می‌شود (invalid → crash اولیه، نه رفتار undefined در runtime)
- `.env` در git نیست؛ الگو در `.env.example`
- آدرس‌های قرارداد/خزانه فقط به‌صورت public config (اصل امنیتی: عمومی‌اند، امنیت از راستی‌آزمایی زنجیره می‌آید نه پنهان‌کاری)

---

## ۸. محدودیت‌های شناخته‌شده (صداقت کامل)

1. **Rate limiter درون‌حافظه است** → در استقرار multi-instance، هر isolate پنجرهٔ خودش را دارد (برای Cloudflare Workers باید به Rate Limiting binding مهاجرت شود — مستند در DEPLOYMENT.md)
2. **burn nonce درون‌حافظه است (best-effort)** → در استقرار multi-isolate، replay یک امضا در isolate دیگرِ دیگر در پنجرهٔ ≤۱۰ دقیقه ممکن است؛ لایه‌های جبرانی: پیام domain+chain-bound است، TTL کوتاه است و مهاجم برای گرفتن امضا باید MITM روی HTTPS خودِ قربانی داشته باشد (که در آن صورت خود کوکی سشن راحت‌تر سرقت می‌شود). ارتقای آینده: Cache API مشترک بین isolateها
3. **Sessionها stateless هستند** → revoke فوری همهٔ سشن‌ها = تغییر SESSION_SECRET (فهرست revoke جانبی وجود ندارد)
4. **Finality نرم برای اعتباردهی** — برای مبالغ خرد عرف است؛ پایش L1 در نقشهٔ راه
5. **تیکر قیمت** کاملاً REST است (poll ۶۰ ثانیه با کش سرور) — هیچ سرویس سوکت/زیرساخت اضافه‌ای برای استقرار لازم نیست
6. امضای پیام (برخلاف تراکنش) در AGW popup باز می‌کند — مطابق الگوی رسمی Abstract فقط از کلیک کاربر فراخوانی می‌شود (نه از effect خودکار) تا popup blocker مرورگر آن را مسدود نکند؛ در حالت بلاک شدن نیز پیام خطای دقیق (`POPUP_BLOCKED`) و دکمهٔ تلاش مجدد ارائه می‌شود
7. **هشدار قیمت کلاینت‌ساید است** → با پاک شدن localStorage از بین می‌رود (مبادلهٔ آگاهانه برای حذف کامل سرور)

---

## ۹. خلاصهٔ مدیریتی

- احراز هویت: **امضای کیف پول + nonce خودامضاشده + راستی‌آزمایی on-chain (EIP-1271/ERC-6492)** — بدون رمز، بدون third-party auth، بدون DB
- سشن: **کوکی HMAC httpOnly + entitlement داخل توکن** با TTL ۷ روز
- پرداخت: **ترانسفر مستقیم روی‌زنجیره (PENGU/ETH) + راستی‌آزمایی کامل سرور از RPC رسمی Abstract + انقضا از timestamp بلاک** — بدون Session Key، بدون approval، بدون ثبت در DB
- بازیابی: **زنجیره خودش دیتابیس است** (اسکن eth_getLogs)
- محتوا: **گیت سرور** با 401/402؛ نشت تاریخی رفع شده
- سوءاستفاده: **rate limit پنجرهٔ لغزان** روی همهٔ endpointها + retry-after
- کلیدها: فقط در کیف پول کاربر؛ ما هیچ کلیدی نگه نمی‌داریم
