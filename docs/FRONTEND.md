# فرانت‌اند PenguSignals — راهنمای توسعه‌دهنده

ساختار کامپوننت‌ها، جریان‌های UI، طراحی واکنش‌گرا (RTL/LTR)، i18n و مدیریت state.

```
src/components/
├── providers.tsx        ← I18n → Theme → AbstractWalletProvider → Toaster
├── i18n/I18nProvider    ← context زبان + t() + ذخیره در localStorage
├── abstract/AbstractProfile  ← آواتار/tier پرتال (اقتباس از رجیستری رسمی build.abs.xyz)
└── pengu/               ← همهٔ بخش‌های صفحهٔ اصلی
    ├── Header.tsx           نوار چسبان: برند + قیمت زنده + زبان + کیف پول
    ├── Hero.tsx             تیتر + CTA + آمار
    ├── LiveTicker.tsx       نوار قیمت لحظه‌ای (WS → REST fallback → loading)
    ├── SignalSection.tsx    سیگنال امروز: PassGate یا محتوای کامل
    ├── PricingSection.tsx   گرید ۶ کارتی (رایگان + ۵ پاس) — داده از passes.ts
    ├── TrackRecord.tsx      سابقهٔ WIN/LOSS
    ├── EngineSection.tsx    شفافیت موتور (۱۱ اندیکاتور + وزن‌ها)
    ├── PriceChart.tsx       چارت (کندل‌های واقعی)
    ├── PriceAlerts.tsx      هشدار قیمت (ساخت/حذف)
    ├── MyDashboard.tsx      هویت پرتال + کیف پول + پاس + عضویت
    ├── PaymentDialog.tsx    دیالوگ پرداخت (v3)
    ├── FaqFooter.tsx        FAQ + فوتر
    ├── useAuth.ts           پل کیف پول ⇄ سشن
    └── useMarket.ts         snapshot بازار + polling + fmt
```

صفحهٔ کاربر فقط `/` است (Next.js App Router) — همهٔ بخش‌ها sectionهای همین صفحه.

---

## حالت‌های کیف پول در Header

| شرط | نمایش |
|---|---|
| کیف پول وصل نیست | دکمهٔ «اتصال کیف پول» → `login()` (popup AGW) |
| وصل + سشن فعال | دراپ‌داون: آواتار پرتال + آدرس کوتاه → کپی آدرس / Explorer / پرتال / خروج |
| وصل + سشن نیست | دکمهٔ «ورود با امضا» → `signIn()` (امضای پیام nonce) |
| chainId ≠ 2741 | قرص هشدار شبکهٔ نادرست |

جریان ورود خودکار: بعد از اتصال کیف پول، `useAuth` یک‌بار برای هر آدرس `signIn(silent)` می‌زند؛ اگر با `POPUP_BLOCKED`/`TIMEOUT` شکست خورد، پیام دقیق (توست بومی‌سازی‌شده) می‌آید و دکمهٔ دستی می‌ماند.

## دیالوگ پرداخت — v3 (نمودار وضعیت)

```
┌─ خلاصه: محصول · مبلغ PENGU · موجودی کیف پول · گیرنده (کپی) · کارمزد ETH ⚠
├─ مسیر A: «پرداخت از کیف پول» → popup تراکنش AGW → hash → رسید زنجیره
│            └─ receipt success → تأیید خودکار → success (لینک Explorer)
├─ مسیر B: «قبلاً پرداخت کرده‌اید؟» → ورود دستی هش → تأیید پرداخت
└─ خطاها: rejected / popup_blocked / timeout / insufficient_balance / send_failed
           + خطاهای سرور: TX_NOT_FOUND / TX_PENDING / TX_FAILED / TX_ALREADY_USED / NO_QUALIFYING_TRANSFER
```

نکات UX:
- **کارمزد ETH**: انتقال ERC-20 اسپانسر نمی‌شود — موجودی ETH نمایش داده می‌شود و صفر بودن آن هشدار قرمز می‌گیرد
- **تأیید خودکار**: با رسید موفق، verify بدون کلیک اجرا می‌شود؛ دکمهٔ دستی فقط fallback است
- خطای verify در مسیر دستی، فرم را باز نگه می‌دارد (به‌جای رفتن به step-2 بی‌مورد)

## داشبورد شخصی (MyDashboard)

- **پنل هویت/کیف پول**: آواتار + tier + نشان‌های پرتال (Tooltip) + آدرس + دکمهٔ کپی با بازخورد ۱.۶ ثانیه
- **موجودی‌ها**: PENGU (عدد بزرگ + برآورد USD از قیمت snapshot) · ETH (کارمزد) — هر دو با `useBalance` و refetch ۳۰s
- **پیوندها**: AbstractScan آدرس · پرتال abs.xyz · پروفایل پرتال
- **کارت پاس**: محصول فعال، انقضا، شمار روز، CTA تمدید
- **کارت عضویت**: عضو از، تعداد پرداخت، سطح (رایگان/دارندهٔ پاس)

---

## طراحی و استایل

- **تم**: dark پیش‌فرض (next-themes، `attribute="class"`)؛ متغیرهای CSS به سبک shadcn (`bg-background`، `text-primary`، …) — بدون رنگ indigo/blue
- **RTL/LTR**: `dir` روی ریشهٔ متن‌ها؛ کلاس‌های منطقی (`ms-`/`me-`/`text-start`)؛ اعداد و آدرس‌ها همیشه `dir="ltr"`
- **گلس‌کارت**: `.glass-card` (backdrop-blur + border ظریف) — هویت بصری
- **واکنش‌گرا**: موبایل-اول؛ قیمت‌پیل Header فقط `sm:` بالاتر؛ گرید قیمت ۱→۲→۳ ستونه؛ تست‌شده در 390px بدون overflow
- **دسترس‌پذیری**: semantic (header/main/section)، آیکون‌ها با متن، focus rings، هدف لمسی ≥44px، `sr-only` جاهای لازم
- **فوتر چسبان**: `min-h-screen flex flex-col` + `mt-auto` — در صفحات کوتاه پایین می‌ماند، در صفحات بلند طبیعی پایین می‌رود

## i18n

- فایل‌های `src/i18n/{fa,en}.json` — کلیدهای تودرتو (`wallet.error.POPUP_BLOCKED`)
- `t(key, params?)` با جایگزینی `{param}`
- سوییچ زبان از Header؛ انتخاب در localStorage
- **قاعدهٔ توسعه**: هر متن UI حتماً در هر دو فایل؛ کدهای خطا = کلید، نه متن خام

## مدیریت State

| داده | ابزار | ملاحظه |
|---|---|---|
| سشن/entitlements | `useAuth` (context-free، هر کامپوننت مستقیم) | refresh بعد از verify |
| بازار | `useMarket` (polling 60s) + `useTicker` (WS) | REST fallback خودکار |
| موجودی‌های زنجیره | wagmi hooks | same RPC as wallet |
| فرم‌های محلی | `useState` | — |
| پروفایل پرتال | `useAbstractProfile` (TanStack, staleTime 2min) | graceful بدون پروفایل |

## قواعد کیفیت (lint-verified)

- TypeScript strict؛ بدون `any` در کد محصول
- `use client` فقط در کامپوننت‌های تعاملی؛ منطق سرور در route handlerها
- اثرهای React به‌صورت async IIFE داخل `useEffect` (قاعدهٔ set-state-in-effect)
- کامپوننت‌های UI فقط از `src/components/ui` (shadcn) — بدون reimplementation
