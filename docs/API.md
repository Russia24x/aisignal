# مرجع کامل API — PenguSignals

همهٔ endpointها زیر `/api` و نسبت به ریشهٔ اپ هستند. همهٔ پاسخ‌ها JSON با فیلد `ok` (boolean) هستند؛ خطاها کد پایدارِ string در `error` برمی‌گردانند.

- 🔓 **عمومی** — بدون احراز هویت
- 🔑 **سشن** — نیازمند کوکی `pengu_session` معتبر
- 💳 **پاس** — نیازمند پاس دسترسی فعال (در غیر این صورت 402)

سقف rate limit برای هر IP (پنجرهٔ لغزان، پاسخ 429 + `retry-after`):

| bucket | حد/دقیقه |
|---|---|
| auth | 30 |
| payment | 10 |
| signal | 30 |
| public | 120 |

---

## احراز هویت

### `GET /api/auth/nonce?address=0x…` — 🔓 (auth)
صدور nonce یک‌بارمصرف + **پیام کامل امضا** (ساخته‌شده توسط سرور).

- پارامتر: `address` (آدرس معتبر checksummed یا lowercase)
- پاسخ 200:
```json
{ "ok": true, "nonce": "hex32", "message": "PenguSignals wants you to sign in…\nNonce: …", "issuedAt": "ISO", "expiresInMs": 300000 }
```
- خطاها: `INVALID_ADDRESS` (400)، `RATE_LIMITED` (429)

### `POST /api/auth/verify` — 🔓 (auth)
تبدیل امضا به سشن.

- بدنه:
```json
{ "address": "0x…", "nonce": "…", "issuedAt": "ISO", "signature": "0x…" }
```
- پاسخ 200: `{ ok: true, entitlements: Entitlements }` + `set-cookie: pengu_session` (httpOnly)
- خطاها: `NONCE_INVALID` / `NONCE_EXPIRED` / `NONCE_MISMATCH` / `BAD_ISSUED_AT` / `BAD_SIGNATURE` / `VERIFICATION_FAILED` / `NONCE_REPLAY` / `INVALID_ADDRESS` (400)
- سمت کلاینت کدها به این خطاهای بومی‌سازی‌شده نگاشت می‌شوند: `RATE_LIMITED` / `SIGNATURE_REJECTED` / `POPUP_BLOCKED` / `TIMEOUT` / `SIGNATURE_FAILED` / `NETWORK`

### `GET /api/auth/session` — 🔓 (public)
وضعیت سشن فعلی.

- پاسخ 200: `{ ok: true, entitlements: Entitlements }` (بدون سشن → همهٔ فیلدها خاموش/تهی)

### `DELETE /api/auth/session` — 🔓 (auth)
خروج (پاک‌کردن کوکی‌ها).

- پاسخ: `{ ok: true }`

### شکل `Entitlements`
```json
{
  "authenticated": true,
  "address": "0x…",
  "platformAccess": false,
  "signalAccess": true,
  "activeGrant": { "product": "PASS_30D", "expiresAt": "ISO" },
  "subscriptionDaysLeft": 27,
  "memberSince": "ISO", "paymentsCount": 3, "lifetime": false
}
```

---

## پرداخت

### `POST /api/payment/verify` — 🔑 (payment)
راستی‌آزمایی تراکنش روی زنجیره و اعتباردهی پاس. کلاینت **فقط هش** می‌فرستد.

- بدنه:
```json
{ "txHash": "0x…64hex…", "product": "PASS_7D" }
```
- `product` یکی از: `PASS_1D` / `PASS_7D` / `PASS_30D` / `PASS_365D` / `PASS_LIFETIME`
- پاسخ 200: `{ ok: true, amountToken: 63, txHash: "0x…", entitlements: Entitlements }`
- خطاها:
  - 400: `INVALID_BODY` / `INVALID_TX_HASH` / `UNKNOWN_PRODUCT` / `TX_FAILED` / `NO_QUALIFYING_TRANSFER`
  - 401: `UNAUTHORIZED`
  - 404: `TX_NOT_FOUND` (تراکنش روی Abstract ناموجود)
  - 202: `TX_PENDING` (شناخته‌شده ولی هنوز ماین نشده — بعداً دوباره)
  - 409-مانند: `TX_ALREADY_USED` (replay)
- منطق کامل ۷-مرحله‌ای: `docs/SECURITY.md §3`

---

## سیگنال‌ها

### `GET /api/signal/today` — 💳 (signal)
سیگنال کامل امروز (اکشن، ورود، حد ضرر، اهداف، استدلال).

- پاسخ 200: `{ ok: true, signal: SignalDTO }`
- 401 بدون سشن؛ 402 با `{ error: "NEED_ACCESS_PASS" }` برای سشن بدون پاس

### `GET /api/signal/preview` — 🔓 (signal)
پیش‌نمایش اجماع اندیکاتورها **بدون محتوای سیگنال** (`action: null` + ماسک).

### `GET /api/signal/history?limit=30` — 🔓 (signal)
سابقهٔ سیگنال‌های **گذشته** (شرط `day < today` — سیگنال امروز هرگز در سابقه نیست) + آمار WIN/LOSS.

---

## بازار

### `GET /api/market/overview` — 🔓 (public)
اسنپ‌شات زنده (قیمت/۲۴ساعت/حجم/نقدینگی/FDV از DexScreener با cache 60s + cross-check CoinGecko هر ۱۰ مرتبه) + خلاصهٔ سیگنال امروز (ماسک‌شده) + وضعیت هشدارهای قیمت.

---

## داشبورد کاربر

### `GET /api/me/dashboard` — 🔑 (public bucket)
اطلاعات داشبورد: عضویت، پرداخت‌ها، وضعیت پاس، آلارم‌ها.

---

## هشدار قیمت

- `GET /api/alerts` — 🔑 فهرست هشدارهای کاربر
- `POST /api/alerts/create` — 🔑 ساخت هشدار `{ direction: "above"|"below", target: number }`
- `DELETE /api/alerts/{id}` — 🔑 حذف (فقط مالک)

---

## پروفایل Abstract (Portal)

### `GET /api/user-profile/{address}` — 🔓 (public)
پروفایل پرتال Abstract (tier، نشان‌ها، آواتار) — با ۵ دقیقه fetch cache و graceful degradation (پروفایل ندارد → `profile: null`).

---

## OG (اسکرین‌شات اجتماعی)

### `GET /api/og` — 🔓
تصویر OG داینامیک.

---

## مدل داده (Prisma — `prisma/schema.prisma`)

| مدل | نقش | فیلدهای کلیدی |
|---|---|---|
| `User` | هویت | `address` (unique, lowercase) |
| `Nonce` | nonceهای احراز هویت | `nonce` (unique), `address?`, `expiresAt`, `usedAt` |
| `AuthSession` | ردپای ورودها | `userId`, `ipHash`, `createdAt` |
| `Payment` | پرداخت‌های تأییدشده | `txHash` (unique), `amountRaw/amountToken`, `product`, `status`, `blockNumber` |
| `AccessGrant` | دسترسی زمان‌محور | `userId`, `product`, `startsAt`, `expiresAt`, `sourcePaymentId` |
| `Signal` | سیگنال روزانه | `day` (unique, UTC), `action`, `confidence`, `score`, `entry/SL/TP`, `indicatorsJson`, `outcome` |
| `EngineSnapshot` | snapshot ورودی موتور | برای ممیزی‌پذیری بازتولید سیگنال |
| `PriceAlert` | هشدار قیمت | `userId`, `direction`, `target`, `active` |

قواعد:
- یک سیگنال در روز (`day` unique) — idempotent
- اعتبار پاس = وجود `AccessGrant` با `expiresAt > now` (پاس‌ها انباشته می‌شوند از `max(now, انقضای فعلی)`)
- `PASS_LIFETIME` = grant ۳۶,۵۰۰ روزه

---

## خطاها — قرارداد عمومی

```json
{ "ok": false, "error": "STABLE_CODE", "retryAfterMs": 42000 }
```
کدها در UI به پیام‌های بومی‌سازی‌شده (fa/en) نگاشت می‌شوند؛ مقدار خام هرگز مستقیم به کاربر نشان داده نمی‌شود (fallback: خود کد).
