# معماری PenguSignals

این سند نقشه کامل سیستم برای توسعه‌دهندگان است. مستندات تکمیلی:

| سند | محتوا |
|---|---|
| `SECURITY.md` | مدل تهدید، احراز هویت، سشن، rate limit، مدل اعتماد پرداخت |
| `API.md` | مرجع کامل endpointها + مدل داده |
| `WALLET-AND-TRANSACTIONS.md` | اتصال کیف پول/امضا/تراکنش — مبتنی بر مستندات رسمی Abstract |
| `TECH-STACK.md` | فناوری‌ها، نسخه‌ها و دلیل انتخاب |
| `BACKEND.md` / `FRONTEND.md` | راهنمای توسعه‌دهندهٔ سرور و کلاینت |
| `ACCESS-MODEL.md` | مدل دسترسی و تعرفه |
| `AUDIT.md` | گزارش ممیزی کامل + نتایج QA |
| `DEPLOYMENT.md` | استقرار |

## اصول طراحی

1. **هیچ چیز هاردکد نیست** — همه پارامترها (آدرس‌ها، قیمت‌ها، وزن‌ها، TTLها، rate limitها) از environment می‌آیند (`src/lib/config.ts` + `src/lib/public-config.ts`)
2. **صفر اعتماد به کلاینت** — هر ادعایی (امضا، پرداخت) سمت سرور راستی‌آزمایی می‌شود
3. **داده‌محور** — همه اعداد نمایش‌داده‌شده از محاسبه واقعی روی داده زنده می‌آیند؛ هیچ دیتای نمایشی وجود ندارد
4. **ماژولار** — هر دامنه (بازار/تحلیل/دسترسی) یک ماژول مستقل با اینترفیس روشن است
5. **قابل ممیزی** — سیگنال هر روز با snapshot کامل اندیکاتورها در DB ذخیره می‌شود

## جریان‌های اصلی

### ۱. اتصال کیف پول و احراز هویت (SIWE)

جزئیات کامل رفتار popup AGW، خطاها و عیب‌یابی: `WALLET-AND-TRANSACTIONS.md`.

```
کلاینت                        سرور                          زنجیره
  │ GET /api/auth/nonce         │
  │ ─────────────────────────►  │ تولید nonce یک‌بارمصرف (TTL ۵ دقیقه)
  │ ◄─── {nonce, message} ───── │ + پیام امضا (domain-bound)
  │                             │
  │ [کاربر پیام را با AGW/EOA امضا می‌کند]
  │                             │
  │ POST /api/auth/verify       │
  │ ─────────────────────────►  │ ۱. اعتبارسنجی nonce (ناموجود/مصرف‌شده/منقضی؟)
  │   {address, nonce,          │ ۲. بررسی issuedAt (±۱۰ دقیقه)
  │    issuedAt, signature}     │ ۳. verifyMessage (EOA یا EIP-1271 برای AGW) ────►
  │ ◄─── set-cookie session ─── │ ۴. burn nonce  ۵. upsert User  ۶. کوکی HMAC
```

سشن: `base64url(payload).base64url(HMAC-SHA256(payload))` — httpOnly, sameSite=lax, secure در production. اعتبارسنجی با مقایسه timing-safe.

### ۲. موتور تحلیل

**داده ورودی:**
- Snapshot زنده از DexScreener (عمیق‌ترین استخر PENGU روی Abstract)
- کندل روزانه ۹۰ روزه + ساعتی ۴۸ ساعته از Binance (fallback: CoinGecko)

**پایپ‌لاین:**

```
Candles (90d) ──► ۱۱ ارزیاب مستقل ──► score ∈ [-1,+1] برای هرکدام
                                            │
                    وزن‌دهی (مجموع ۱۰۰) ─────┤
                                            ▼
                                  امتیاز مرکب ∈ [-100,+100]
                                            │
                     ┌──────────────────────┼──────────────────────┐
                     ▼                      ▼                      ▼
               score ≥ +20            -20 < score < +20       score ≤ -20
                  BUY                     HOLD                   SELL
                     │                      │                      │
                     └──────────────┬───────┴──────────────────────┘
                                    ▼
                     سطوح ریسک (ATR×1.2 SL / ×1.8 TP1 / ×3.0 TP2)
                     + اطمینان (قدرت امتیاز × توافق اندیکاتورها × کیفیت داده)
                     + استدلال دوزبانه تولیدشده از اعداد واقعی
```

**ارزیاب‌ها و وزن‌ها** (`src/lib/modules/analysis/signals.ts`):

| ارزیاب | وزن | منطق |
|---|---|---|
| emaTrend | ۱۴ | فاصله EMA9/EMA21 + موقعیت قیمت نسبت به EMA21 |
| rsi | ۱۴ | نواحی اشباع فروش/خرید با نگاشت پیوسته + جهت RSI |
| macd | ۱۴ | هیستوگرام نرمال‌شده + تشدید/تضعیف |
| smaStructure | ۱۰ |golden/death cross + ساختار قیمت |
| bollinger | ۱۰ | موقعیت %B + تشخیص squeeze (کاهش اتکا) |
| stochastic | ۹ | نواحی + کراس %K/%D |
| obv | ۸ | شیب OBV + واگرایی با قیمت |
| srLevels | ۸ | موقعیت در کانال حمایت-مقاومت |
| vwap | ۷ | فاصله از VWAP غلتان (کاهش در فواصل افراطی) |
| momentum | ۷ | ROC(10) + شیب رگرسیون خطی |
| volume | ۷ | تأیید حرکت قیمت توسط حجم |

**قطعیت (Determinism):** با داده یکسان، خروجی یکسان است — سیگنال هر روز یک بار در DB ذخیره و بین همه کاربران پولی مشترک است (انصاف + ممیزی).

### ۳. تأیید پرداخت روی زنجیره

```
کلاینت                        سرور                          RPC Abstract
  │ [ERC-20 transfer(treasury, amount)]
  │ ────────────────────────────────────────────────────────►
  │ ◄── txHash ──────────────────────────────────────────────
  │                             │
  │ POST /api/payment/verify    │
  │ ─────────────────────────►  │ getTransactionReceipt ─────►
  │   {txHash, product}         │ ◄─── receipt + logs ────────
  │                             │ بررسی‌ها:
  │                             │  • status == success
  │                             │  • Transfer(PENGU → treasury)
  │                             │  • from == کیف سشن کاربر
  │                             │  • amount ≥ قیمت محصول
  │                             │  • txHash قبلاً استفاده نشده (یکتا در DB)
  │ ◄── {ok, entitlements} ──── │ ایجاد Payment + AccessGrant (atomic)
```

**محصولات و دسترسی:**
- پاس‌های دسترسی v3 (بدون Session Key — جزئیات: `ACCESS-MODEL.md`)، مبنای ۱۰ پنگو/روز
  با تخفیف پلکانی ۰/۱۰/۲۰/۳۰٪ (سقف ۳۰٪):
  `PASS_1D` (۱۰ پنگو)، `PASS_7D` (۶۳)، `PASS_30D` (۲۴۰)،
  `PASS_365D` (۲,۵۵۵)، `PASS_LIFETIME` (۵,۱۱۰ = 2× سالانه) — همه grant تمدیدشونده
  (از انتهای پاس فعلی یا اکنون). ورود و مرور رایگان است؛ فقط محتوای سیگنال
  نیاز به پاس فعال دارد. منبع واحد: `src/lib/modules/access/passes.ts`

**دیالوگ پرداخت (v3):** فازها idle → sending → sent → (رسید زنجیره → تأیید خودکار) → verifying → success؛
به‌علاوهٔ مسیر دستی «قبلاً پرداخت کرده‌اید؟» برای هش پرداخت‌شده از کیف پول دیگر.
خطاها همگی کد پایدار دارند (rejected / popup_blocked / timeout / insufficient_balance /
TX_NOT_FOUND / TX_PENDING / TX_FAILED / TX_ALREADY_USED / NO_QUALIFYING_TRANSFER) و به
پیام بومی‌سازی‌شده (fa/en) نگاشت می‌شوند. دیاگرام کامل: `FRONTEND.md`.

### ۴. ارزیابی عملکرد (Track Record)

هر سیگنال بعد از ۲۴ ساعت (در اولین درخواست history) با قیمت لحظه‌ای مقایسه و علامت‌گذاری می‌شود:
- BUY: درست اگر قیمت بالا رفته باشد
- SELL: درست اگر قیمت پایین رفته باشد
- HOLD: درست اگر تغییر < ۳٪ باشد

## دیتابیس (Prisma / SQLite)

| مدل | نقش |
|---|---|
| `User` | هویت کیف‌محور + وضعیت platformAccess |
| `Nonce` | nonce های یک‌بارمصرف احراز هویت |
| `AuthSession` | سوابق نشست (زیرساخت لغو نشست) |
| `Payment` | تراکنش‌های تأییدشده (txHash یکتا = ضد replay) |
| `AccessGrant` | دسترسی‌های زمان‌دار |
| `Signal` | سیگنال روزانه + snapshot کامل + نتیجه |
| `EngineSnapshot` | وزن‌های موتور در هر روز (ممیزی تاریخی) |

## کش و کارایی

- `TTLCache` با stale-while-revalidate: snapshot (۶۰ث) و history (۱۵دقیقه)
- فقط ۲-۳ فراخوانی upstream در هر بازه کش؛ محافظت از rate limit های عمومی
- react-query سمت کلاینت با staleTime ۶۰ ثانیه

## افزودن زبان جدید

1. فایل `src/i18n/<code>.json` بسازید (کپی از `en.json`)
2. در `src/components/i18n/I18nProvider.tsx` دیکشنری را import و به `dictionaries` اضافه کنید
3. کد زبان را در `NEXT_PUBLIC_SUPPORTED_LOCALES` اضافه کنید

## افزودن اندیکاتور جدید

1. در `indicators.ts` تابع ریاضی خالص بنویسید
2. در `signals.ts` یک ارزیاب بسازید که `FactorResult` برمی‌گرداند (score ∈ [-1,1]، weight)
3. به `computeFactors` اضافه کنید — وزن‌ها خودکار نرمال می‌شوند
4. برچسب دوزبانه در `FACTOR_LABELS` (SignalSection.tsx) و توضیح در `describeFactor` (engine.ts)

## پایش و لاگ

- لاگ JSON ساختاریافته با scope (scope:market:dexscreener و…)
- warning های خودکار: واگرایی قیمت بین منابع، شکست fallback
- متریک‌ها: `generationMs` در جدول Signal
