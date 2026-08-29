# مرجع کامل API — PenguSignals (v4 Stateless)

همهٔ endpointها زیر `/api` و نسبت به ریشهٔ اپ هستند. همهٔ پاسخ‌ها JSON با فیلد `ok` (boolean) هستند؛ خطاها کد پایدارِ string در `error` برمی‌گردانند.

- 🔓 **عمومی** — بدون احراز هویت
- 🔑 **سشن** — نیازمند کوکی `pengu_session` معتبر یا `Authorization: Bearer <token>`
- 💳 **پاس** — نیازمند پاس دسترسی فعال (در غیر این صورت 402)

سقف rate limit برای هر IP (پنجرهٔ لغزان، پاسخ 429 + `retry-after`):

| bucket | حد |
|---|---|
| auth | 30/دقیقه |
| payment | 10/دقیقه |
| signal | 30/دقیقه |
| public | 120/دقیقه |
| restore | 6/5دقیقه |

---

## احراز هویت

### `GET /api/auth/nonce?address=0x…` — 🔓 (auth)
صدور nonce خودامضاشده (stateless) + **پیام کامل امضا** (ساخته‌شده توسط سرور).

- پارامتر: `address` (آدرس معتبر)
- پاسخ 200:
```json
{ "ok": true, "nonce": "v1<random48hex><tsHex><hmac64hex>", "message": "PenguSignals wants you to sign in…\nNonce: …", "issuedAt": "ISO", "expiresInMs": 600000 }
```
- خطاها: `INVALID_ADDRESS` (400)، `RATE_LIMITED` (429)

### `POST /api/auth/verify` — 🔓 (auth)
تبدیل امضا به سشن (شکل رسمی SIWE).

- بدنه: `{ "message": "<exact EIP-4361>", "signature": "0x…" }`
- پاسخ 200: `{ ok: true, user: { address }, sessionToken }` + `set-cookie: pengu_session`
  (`sessionToken` همان توکن امضاشده است — برای iframeها در localStorage نگه داشته و به‌صورت Bearer ارسال می‌شود)
- خطاها: `INVALID_MESSAGE` / `INVALID_ADDRESS` / `INVALID_CHAIN` / `INVALID_DOMAIN` / `MESSAGE_EXPIRED` / `BAD_ISSUED_AT` / `NONCE_INVALID` / `NONCE_REPLAY` / `BAD_SIGNATURE` / `VERIFICATION_FAILED` (401)

### `GET /api/auth/session` — 🔓 (public)
سشن فعلی + entitlements (از claim داخل سشن — بدون DB) + `sessionMode` (cookie|bearer|null برای عیب‌یابی).

### `DELETE /api/auth/session` — 🔑 (auth)
خروج (پاک‌کردن کوکی؛ توکن Bearer سمت کلاینت پاک می‌شود).

---

## بازیابی اشتراک از زنجیره

### `POST /api/access/restore` — 🔑 (restore)
اسکن `eth_getLogs` چانکی (۴۰۰ روز اخیر) برای پرداخت‌های ERC-20 کاربر به خزانه؛ بازپخش زمانی با semantics انباشته؛ مینت بهترین entitlement داخل سشن جدید (فقط اگر بهتر از فعلی باشد).

- پاسخ 200: `{ ok, restored: boolean, entitlements, sessionToken?, paymentsFound: number }`
- خطاها: `UNAUTHORIZED` (401)، `SCAN_FAILED` (502)، `RATE_LIMITED` (429)
- نکته: تراکنش‌های native ETH لاگ ندارند → ETH فقط با verify هش دستی بازیابی می‌شود

---

## بازار

### `GET /api/market/overview` — 🔓 (public)
snapshot زنده + کندل‌های روزانه/ساعتی + آمار track record.

```json
{
  "ok": true,
  "snapshot": { "priceUsd": 0.009006, "change24h": -4.4, "change5m": null, "change1h": 0.29,
                "volume24hUsd": 9966292, "liquidityUsd": 442538, "fdvUsd": null, "marketCapUsd": 565691124,
                "source": "binance", "fetchedAt": 1788000000000 },
  "daily": [Candle…120],
  "hourly": [Candle…48],
  "trackRecord": { "total": 304, "closed": 304, "wins": 149, "losses": 155, "winRate": 49, "avgConfidence": 49.9 },
  "chain": { "id": 2741, "name": "Abstract", "explorer": "https://abscan.org" },
  "token": { "symbol": "PENGU", "address": "0x9ebe…" }
}
```

---

## سیگنال

### `GET /api/signal/preview` — 🔓 (signal)
پیش‌نمایش رایگان: اجماع فاکتورها + نقطه‌های تایم‌فریم (بدون امتیاز/سطوح/استدلال).

```json
{ "ok": true, "day": "2026-08-29", "action": null, "confidence": null,
  "consensus": { "bullish": 5, "bearish": 5, "neutral": 0, "total": 10 },
  "timeframes": [ { "timeframe": "15m", "action": "WAIT" }, … { "timeframe": "1d", "action": "BUY" } ],
  "indicatorsCount": 5, "dataQuality": 1, "candlesUsed": 210 }
```

### `GET /api/signal/today` — 💳 (signal)
محصول پولی: سیگنال زندهٔ چند-تایم‌فریمی کامل.

```json
{
  "ok": true, "day": "2026-08-29",
  "signal": {
    "action": "BUY", "band": "BUY", "score": 78.5, "confidence": 71,
    "price": 0.009006, "dataQuality": 1, "volatilityWarning": false,
    "timeframes": {
      "15m": { "score": 52.1, "action": "WAIT", "band": "WAIT", "confidence": 33, "atrPct": 0.42, "candlesUsed": 200 },
      "1h":  { … }, "4h": { … }, "1d": { "score": 88.3, "action": "BUY", … }
    },
    "entryLow": 0.00891, "entryHigh": 0.00905, "stopLoss": 0.0082,
    "takeProfit1": 0.0101, "takeProfit2": 0.0112, "riskReward": 1.5,
    "expectedRangeLow": 0.0085, "expectedRangeHigh": 0.0095,
    "factors": [ { "key": "trend", "score": 0.81, "weight": 30, "contribution": 24.3 }, … ],
    "reasoning": { "fa": "…", "en": "…" }
  },
  "entitlements": Entitlements
}
```
- خطاها: `UNAUTHORIZED` (401)، `PAYMENT_REQUIRED` (402)، `INSUFFICIENT_HISTORY` (503)

### `GET /api/signal/history?limit=30&offset=0` — 🔓 (public)
Track record عمومی — **بازمحاسبه قطعی از کندل‌های عمومی** (بدون امروز).

- آیتم: `{ day, action, band, confidence, score (0-100), priceAtSignal, outcome (WIN|LOSS), outcomePrice, priceChangePct, correct }`
- `stats` روی کل تاریخچه است؛ `curve` منحنی تجمعی بازده استراتژی

### `GET /api/signal/detail?day=YYYY-MM-DD` — 🔓 (public)
دریل‌داون یک روز گذشته: امتیاز + سطوح + فاکتورها + نتیجه. `day >= today` → 403 `TODAY_PAYWALLED`.

---

## پرداخت

### `GET /api/payment/config` — 🔓 (public)
توکن‌های پرداخت + کاتالوگ + **کوت‌های امضاشده** برای توکن‌های غیر PENGU.

```json
{
  "ok": true,
  "chain": { "id": 2741, … },
  "token": { "symbol": "PENGU", "address": "0x9ebe…", "decimals": 18 },
  "tokens": [ { "key": "PENGU", "kind": "erc20", … }, { "key": "ETH", "kind": "native", … } ],
  "treasury": "0x60df…",
  "products": { "PASS_1D": { "pricePengu": 10, "days": 1 }, "PASS_7D": { "pricePengu": 50 }, … },
  "quotes": { "PASS_1D": { "ETH": { "amountToken": 0.000037, "quote": { product, token, amountToken, quotedAt, sig } } } }
}
```

### `POST /api/payment/verify` — 🔑 (payment)
تأیید پرداخت روی زنجیره + مینت entitlement داخل سشن.

- بدنه: `{ "txHash": "0x…", "product": "PASS_…", "quote?" }` — quote برای توکن‌های غیر PENGU الزامی است
- پاسخ 200: `{ ok: true, amountToken, token, entitlements, sessionToken }`
- خطاها: `INVALID_TX_HASH` / `UNKNOWN_PRODUCT` / `QUOTE_REQUIRED` / `QUOTE_INVALID` / `INSUFFICIENT_AMOUNT` / `UNSUPPORTED_TOKEN` / `NO_QUALIFYING_TRANSFER` (400)، `TX_PENDING` (202)، `TX_NOT_FOUND` (404)، `TX_FAILED`
- **انقضا از timestamp بلاک** محاسبه می‌شود → replay تراکنش قدیمی پاس منقضی می‌دهد

### `GET /api/payment/history` — 🔑 (payment)
پرداخت‌های on-chain (اسکن سبک ۴۵ روز اخیر؛ فقط ERC-20 — تراکنش native ETH لاگ ندارد).

---

## داشبورد

### `GET /api/me/dashboard` — 🔑 (signal)
خلاصهٔ کاربر از سشن + اسکن سبک زنجیره: `entitlements`, `activeGrant` (با نوار پیشرفت), `payments` (۵ مورد اخیر), `memberSince` (زمان صدور سشن — بدون رکورد حساب), `paymentsCount`, `totalSpentPengu`.

---

## سایر

### `GET /api` — 🔓
سلامت سرویس.

### `GET /api/agw/details` — 🔓
پروکسی جزئیات AGW provider (کش ۱ ساعته؛ خارج از مسیر بحرانی).

### `GET /api/user-profile/[address]` — 🔓 (public)
پروفایل پرتال Abstract (پروکسی کش‌شده).

### `GET /api/og` — 🔓
کارت OG استاتیک (SVG، کش ۱ ساعته).

---

## مدل‌های مشترک

```ts
interface Entitlements {
  authenticated: boolean; address: string | null;
  platformAccess: boolean;          // ≡ authenticated (لایه رایگان)
  signalAccess: boolean;            // پاس فعال
  activeGrant: { product: string; expiresAt: string; lifetime: boolean; txHash?: string } | null;
  subscriptionDaysLeft: number;
}
```

هشدار قیمت: **بدون API** — کاملاً کلاینت‌ساید (localStorage).
