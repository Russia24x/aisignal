# کیف پول و تراکنش‌ها — راهنمای کامل (مبتنی بر مستندات رسمی)

این سند مرجع کامل اتصال کیف پول، احراز هویت، امضا و تراکنش‌های PenguSignals است و **مطابق مستندات رسمی Abstract** (docs.abs.xyz و build.abs.xyz، تاریخ بازبینی: این ممیزی) بازبینی شده است. هر ادعای فنی منبع رسمی خود را دارد.

> 🔗 منابع اصلی:
> - `https://docs.abs.xyz/abstract-global-wallet/getting-started` (نقطه ورود رسمی؛ مسیر `/quickstart` قدیمی حذف شده است)
> - `https://docs.abs.xyz/abstract-global-wallet/agw-react/AbstractWalletProvider`
> - `https://docs.abs.xyz/abstract-global-wallet/agw-react/hooks/useLoginWithAbstract`
> - `https://docs.abs.xyz/abstract-global-wallet/agw-client/actions/signMessage`
> - `https://docs.abs.xyz/abstract-global-wallet/agw-client/actions/writeContract`
> - `https://docs.abs.xyz/connect-to-abstract` (پارامترهای شبکه)
> - `https://docs.abs.xyz/how-abstract-works/architecture/transaction-lifecycle` (نهایی شدن تراکنش)

---

## ۱. پارامترهای شبکه Abstract (رسمی)

| پارامتر | مقدار | منبع |
|---|---|---|
| Chain ID | **2741** | docs.abs.xyz/connect-to-abstract |
| RPC | `https://api.mainnet.abs.xyz` | همان |
| WebSocket | `wss://api.mainnet.abs.xyz/ws` | همان |
| Explorer | `https://abscan.org` (+ `explorer.abs.xyz` به‌عنوان explorer بومی) | docs.abs.xyz/tooling/block-explorers |
| توکن PENGU | `0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62` (۱۸ رقم اعشار — روی زنجیره راستی‌آزمایی‌شده) | خواندن مستقیم `name()/symbol()/decimals()` از RPC |
| ارز کارمزد | ETH | — |

نکته: آدرس PENGU در جدول deployed-contracts رسمی نیست (فقط WETH/USDC/USDT آنجا هستند)؛ آدرس بالا با فراخوانی مستقیم قرارداد روی mainnet و فهرست شدن در AbstractScan تأیید شده است.

---

## ۲. راه‌اندازی AGW در پروژه (فایل `src/components/providers.tsx`)

الگوی رسمی `AbstractWalletProvider`:

```tsx
"use client";
import { http } from "viem";
import { abstract } from "viem/chains";           // ✅ از viem/chains — نه agw-client/chains
import { AbstractWalletProvider } from "@abstract-foundation/agw-react";

<AbstractWalletProvider
  chain={abstract}                                // اجباری — فقط abstract / abstractTestnet
  transport={http(publicConfig.rpcUrl)}           // اختیاری — پیش‌فرض http با batch
  queryClient={queryClient}
>
```

نکات رسمیِ رعایت‌شده در پروژه:
- **زنجیره از `viem/chains`** وارد می‌شود (خروجی `@abstract-foundation/agw-client/chains` وجود ندارد).
- `AbstractWalletProvider` خودش `WagmiProvider` + `QueryClientProvider` را می‌پیچد — نیازی به افزودن دستی آنها نیست.
- فقط `http()` transport مستند است؛ برای WebSocket توصیه رسمی وجود ندارد.
- نسخه‌ها: `agw-react 1.13.0` (آخرین)، `wagmi 2.x` (⚠️ wagmi 3 با agw-react فعلی ناسازگار است — peer requirement `^2.17.5`)، `viem 2.56.0`، `@tanstack/react-query 5`.

---

## ۳. اتصال کیف پول و رفتار پاپ‌آپ (مودال)

### چگونه «مودال» واقعاً باز می‌شود

طبق کد منبع SDK (`@privy-io/cross-app-connect` که در agw-react 1.12+ به‌صورت خودکار نصب می‌شود):

- رابط اتصال/امضا/تراکنش AGW یک **پنجره popup** با ابعاد ۴۴۰×۶۸۰ از طریق `window.open` است (نه iframe داخل صفحه).
- `login()` (از `useLoginWithAbstract`) درخواست `eth_requestAccounts` می‌فرستد → popup در مسیر `.../cross-app/connect` باز می‌شود؛ هر درخواست امضا/تراکنش popup مسیر `.../cross-app/transact` را باز می‌کند.
- کاربر جدید می‌تواند همان‌جا (داخل popup) کیف پول AGW بسازد — **استقرار قرارداد اسمارت‌اکانت AGW با paymaster اسپانسر می‌شود** (کاربر برای ساخت کیف پول به ETH نیاز ندارد) — منبع: FAQ رسمی.

### خطاها و رفتارهای شناخته‌شده (استخراج از سورس SDK)

| وضعیت | رشته/کد خطا | نحوه مدیریت در پروژه |
|---|---|---|
| کاربر popup را ببندد / رد کند | `Error("User rejected request")` → کد EIP-1193 **4001** (wagmi: `UserRejectedRequestError`) | `SIGNATURE_REJECTED` → توست بومی‌سازی‌شده |
| popup توسط مرورگر بلاک شود | `"Failed to initialize request"` (`window.open` → null) | `POPUP_BLOCKED` → توست «اجازهٔ پاپ‌آپ بدهید» |
| عدم پاسخ در ۲ دقیقه | `"Request timeout"` / `"Authorization request timed out after …"` | `TIMEOUT` → توست «مهلت تمام شد» |
| موجودی ناکافی (از agw-client 1.7.2+) | خطای صریح insufficient balance | `insufficient_balance` در دیالوگ پرداخت |

### قواعد طلایی اتصال (رسمی/کاوش‌شده)

1. **`login()` فقط داخل event handler کلیک صدا زده شود** — هرگز در `useEffect` یا به‌صورت برنامه‌ای. علت: `window.open` بعد از کارِ async SDK (تولید کلید ECDH + فراخوانی `auth.privy.io` در اولین اتصال) اجرا می‌شود و «user activation» گذرا (≈۵ ثانیه) مرورگر ممکن است منقضی شده باشد → popup بلاک می‌شود.
2. **اتصال مجدد خودکار**: wagmi با `ssr: true` ساخته می‌شود و اتصال Privy در localStorage (کلید `privy-caw:{appId}:connection` با انقضا) ذخیره می‌شود — پس از reload صفحه، کیف پول خودکار reconnect می‌شود.
3. **دو آدرس برای هر اتصال**: `useAccount().address` = آدرس **اسمارت‌اکانت (AGW)** و `useGlobalWalletSignerAccount().address` = آدرس **EOA امضاکننده**. ما همیشه با آدرس اسمارت‌اکانت کار می‌کنیم (هویت کاربر).
4. AGW فقط روی Abstract کار می‌کند (SDK chain-agnostic نیست) — با این حال Header اگر chainId متفاوت گزارش شد هشدار شبکهٔ نادرست نشان می‌دهد.
5. `isConnectModalOpen` در نسخه‌های فعلی SDK **وجود ندارد** — استفاده نکنید.

### جریان کامل ورود (login → session)

```
[کلیک «اتصال کیف پول»]  ← user gesture الزامی
        │ login() → popup AGW باز می‌شود
        ▼
useAccount → status: "connected" (address = AGW)
        │ (اثر خودکار useAuth — یک‌بار برای هر آدرس)
        ▼
GET /api/auth/nonce?address=0x…  ← nonce یک‌بارمصرف + پیام امضا
        │
        ▼
signMessageAsync({ message }) → popup امضای AGW
        ▼
POST /api/auth/verify {address, nonce, issuedAt, signature}
        │  سرور: اعتبار nonce → verifyMessage (EIP-1271) → burn nonce
        ▼
set-cookie: pengu_session (HMAC) → entitlements فعال می‌شود
```

اگر ورودِ خودکار با `POPUP_BLOCKED` شکست بخورد، دکمهٔ «ورود با امضا» در Header باقی می‌ماند تا کاربر با کلیک (user gesture تازه) دوباره تلاش کند — و پیام دقیق دلیل شکست را می‌بیند.

---

## ۴. امضای پیام (SIWE) — الگوی EIP-1271

امضای AGW یک **امضای اسمارت‌اکانت (EIP-1271)** است، نه `personal_sign` سادهٔ EOA:

- ساختار داخلی: امضای EIP-712 با دامنهٔ `{name:"AbstractGlobalWallet", version:"1.0.0"}` و نوع `AGWMessage(bytes32 signedHash)` + کدگذاری validator (`0x74b9ae28…`) — و در صورت استقرارنیافتن بودن اکانت، با **ERC-6492** پیچیده می‌شود.
- بنابراین **راستی‌آزمایی باید مقابل آدرس اسمارت‌اکانت انجام شود** (نه EOA) — دقیقاً همان الگوی مثال رسمی `agw-signing-messages`:

```ts
// سرور — src/lib/security/siwe.ts
const valid = await chainClient.verifyMessage({
  address,     // آدرس AGW (اسمارت‌اکانت)
  message,     // پیام ساخته‌شده توسط سرور
  signature,   // امضای برگشتی کیف پول
});
```

`viem` خودش تشخیص می‌دهد که در آدرس قرارداد وجود دارد → `isValidSignature` (EIP-1271) را صدا می‌زند و برای اکانت‌های استقرارنیافته از verifier ERC-6492 (`0xfB688330…`) استفاده می‌کند. **ecRecover دستی ممنوع** — امضا ساختار EIP-712/1271 دارد و بازیابی سادهٔ کلید نتیجهٔ اشتباه می‌دهد.

محتوای پیام (فرمت EIP-4361-مانند): دامنه، آدرس، بیانیه، URI، نسخه، Chain ID، nonce (یک‌بارمصرف، TTL ۵ دقیقه)، Issued At (پنجرهٔ ±۱۰ دقیقه). پیام **کاملاً توسط سرور ساخته می‌شود**؛ کلاینت فقط آن را به کیف پول می‌دهد.

---

## ۵. ارسال تراکنش (پرداخت PENGU)

### الگوی رسمی writeContract + جزئیات پروژه

```tsx
// src/components/pengu/PaymentDialog.tsx
const hash = await writeContractAsync({
  address: publicConfig.penguToken,     // PENGU (۱۸ رقم اعشار)
  abi: erc20Abi,                        // viem — شامل transfer(address,uint256)
  functionName: "transfer",
  args: [publicConfig.treasury, parseUnits(String(price), 18)],
  chainId: publicConfig.chainId,        // 2741
});
// سپس: useWaitForTransactionReceipt({ hash }) تا رسیدِ زنجیره
```

نکات رسمی:
- تراکنش **از قرارداد اسمارت‌اکانت AGW** ارسال و توسط EOA امضا می‌شود.
- ⚠️ **انتقال‌های معمولی ERC-20 اسپانسر نمی‌شوند** — فقط استقرار خود کیف پول paymaster دارد. یعنی **کاربر برای کارمزد به کمی ETH نیاز دارد**. دیالوگ پرداخت موجودی ETH را نمایش می‌دهد و اگر صفر بود هشدار می‌دهد.
- Session Key برای ترانسفر معمولی لازم نیست (و در mainnet سیاست امنیتی/بازبینی خاص خودش را دارد) — مدل ما Session-Key-free است؛ جزئیات: `docs/ACCESS-MODEL.md`.
- از agw-client 1.7.2+ اگر `موجودی < مبلغ + کارمزد` باشد خطای صریح insufficient balance می‌گیرید.

### چرخهٔ وضعیت دیالوگ پرداخت (v3)

```
idle ── «پرداخت از کیف پول» ──► sending ──(hash)──► sent ──receipt success──► verifying ──► success
  ▲                                  │                  │                        │
  │                                  └─ خطا ←── رد/بلاک/تایم‌اوت/موجودی        └─ خطا → بازگشت به حالت قبل
  └── «قبلاً پرداخت کرده‌اید؟» → ورود دستی هش → verifying (بدون ارسال از مرورگر)
```

- **تأیید خودکار**: به‌محض رسید موفق (`useWaitForTransactionReceipt`)، verify خودکار اجرا می‌شود — کاربر لازم نیست دکمه بزند.
- **مسیر دستی**: اگر کاربر از جای دیگری (مثلاً کیف پول پرتال) پول فرستاده باشد، با «قبلاً پرداخت کرده‌اید؟» هش را وارد می‌کند.
- اگر verify شکست بخورد: در حالت wallet-sent به همان step-2 برمی‌گردد؛ در حالت دستی فرم ورود هش باز می‌ماند و خطای بومی‌سازی‌شده می‌بیند.

---

## ۶. راستی‌آزمایی سمت سرور (کامل‌ترین لایه)

فایل: `src/lib/modules/access/payments.ts` — کلاینت **هیچ‌وقت** ادعای پرداخت نمی‌کند؛ فقط هش می‌فرستد:

1. **فرمت هش**: `/^0x[0-9a-f]{64}$/`
2. **Replay protection**: هش یکتا در جدول `Payment` (دو بار: قبل و داخل تراکنش DB)
3. **رسید**: `getTransactionReceipt` → `status === "success"` (اگر تراکنش شناخته‌شده ولی هنوز ماین‌نشده باشد → `TX_PENDING` با 202؛ نامعلوم → `TX_NOT_FOUND` با 404)
4. **لاگ Transfer**: topic0 = `0xddf252ad…b3ef` (event selector استاندارد `Transfer(address,address,uint256)` ERC-20 — بازمحاسبه‌شده با viem و منطبق) و در لاگ:
   - `token == قرارداد PENGU`
   - `to == خزانه`
   - `from == آدرس سشنِ کاربر` (نه هر آدرسی!)
   - `value ≥ قیمت پاس` (بر حسب واحد پایه ۱۸ رقمی)
5. **اعتبار قیمت از کاتالوگ سرور** (`passes.ts`) — نه از کلاینت
6. **تراکنش اتمیک DB**: ثبت Payment + ایجاد AccessGrant با تمدید انباشته از `max(now, انقضای فعلی)`

### نکتهٔ نهایی‌بودن (Finality)

طبق `transaction-lifecycle` رسمی: موفقیت receipt روی L2 یک **soft confirmation** است؛ نهایی‌بودن قطعی پس از `executeBatches` روی L1 است و قبل از آن rollback نظری ممکن است. عرف اکوسیستم برای پرداخت‌های خرد، اعتباردهی با همان `status === "success"` است (کارت که الکترونیکی نیست؛ در صورت نیاز برای مبالغ بزرگ می‌توان batch/L1 را هم پایش کرد — `zks_L1BatchNumber`).

---

## ۷. پرتال Abstract و Explorer

| مقصد | URL | کاربرد در پروژه |
|---|---|---|
| پرتال (مدیریت کیف پول، XP، نشان‌ها) | `https://abs.xyz` (و `portal.abs.xyz`) | دکمهٔ «باز کردن پرتال» در داشبورد |
| پروفایل عمومی پرتال | `https://abs.xyz/profile/{address}` | لینک «مشاهده در پرتال» (Header + داشبورد) |
| API عمومی پروفایل | `backend.portal.abs.xyz/api/user/address/{addr}` | کامپوننت AbstractProfile (آواتار/tier/نشان‌ها) |
| Explorer آدرس | `https://abscan.org/address/0x…` | لینک‌های «مشاهده در Explorer» |
| Explorer تراکنش | `https://abscan.org/tx/0x…` | لینک هش تراکنش در دیالوگ پرداخت |

⚠️ نکتهٔ پرتال: آدرس واریز CEX در پرتال با آدرس AGW روی Abstract **فرق دارد** (QR صرافی‌ها آدرس zkSync Era است) — برای واریز از CEX حتماً از مسیر پرتال اقدام کنید.

---

## ۸. عیب‌یابی (Troubleshooting)

| مشکل | علت | راه‌حل |
|---|---|---|
| کلیک «اتصال» هیچ پنجره‌ای باز نمی‌کند | popup blocker مرورگر (به‌خصوص اولین اتصال که fetch اولیه SDK طول می‌کشد) | اجازهٔ popup به سایت بدهید؛ دوباره کلیک کنید. پیام `POPUP_BLOCKED` دقیقاً همین را می‌گوید |
| «Request timed out» | popup بیش از ۲ دقیقه بدون پاسخ ماند | دوباره تلاش کنید؛ اتصال اینترنت/پرتال را چک کنید |
| popup باز می‌شود ولی امضا نمی‌آید | درخواست در سمت پرتال pend ماند | بستن popup = رد (`SIGNATURE_REJECTED`)؛ تلاش مجدد |
| تراکنش send می‌شود ولی fail می‌شود | **ETH صفر برای کارمزد** یا slippage/موجودی PENGU | موجودی ETH و PENGU را در دیالوگ ببینید؛ از پرتال ETH تهیه کنید |
| `TX_NOT_FOUND` هنگام verify | هش غلط/هنوز ماین نشده روی Abstract | چند ثانیه بعد دوباره (اگر pending باشد خودکار 202 می‌آید) |
| `TX_ALREADY_USED` | این هش قبلاً اعتبار داده شده | هر پرداخت فقط یک‌بار قابل استفاده است (replay protection) |
| `NO_QUALIFYING_TRANSFER` | مبلغ/گیرنده/فرستنده با پاس انتخابی نمی‌خواند | مبلغ ≥ قیمت پاس و از همان کیف پولِ سشن فرستاده شود |
| بعد از reload، داشبورد هست ولی کیف پول وصل نیست | انقضای اتصال محلی Privy در برابر کوکی ۷روزهٔ سشن — دو چرخهٔ عمر جدا هستند | طبیعی است: سشن سرور تا انقضای کوکی معتبر است و داشبورد کار می‌کند؛ برای عملیات زنجیره‌ای (امضا/پرداخت) دوباره «اتصال کیف پول» بزنید |

---

## ۹. چک‌لیست انطباق با مستندات رسمی (خلاصهٔ ممیزی)

| مورد | وضعیت |
|---|---|
| Provider رسمی + chain از `viem/chains` | ✅ منطبق |
| `login()` فقط در کلیک‌هندلر | ✅ منطبق |
| امضا با `signMessageAsync` و راستی‌آزمایی EIP-1271 مقابل آدرس اسمارت‌اکانت | ✅ منطبق |
| nonce یک‌بارمصرف + پیام ساخته‌شده توسط سرور | ✅ منطبق |
| ERC-20 `transfer` با `erc20Abi` + `parseUnits(…, 18)` | ✅ منطبق |
| انتظار رسید با `useWaitForTransactionReceipt` | ✅ منطبق (+ تأیید خودکار) |
| راستی‌آزمایی سرور: receipt + لاگ Transfer + replay protection | ✅ منطبق |
| هشدار ETH-for-gas (تراکنش‌ها اسپانسر نیستند) | ✅ اضافه شد (این ممیزی) |
| مدیریت خطاهای popup (4001 / بلاک / تایم‌اوت) | ✅ اضافه شد (این ممیزی) |
| wagmi روی v2 (نه v3) | ✅ |
| آدرس PENGU رسمی + ۱۸ اعشار | ✅ راستی‌آزمایی روی زنجیره |
| آدرس‌های abscan.org / abs.xyz | ✅ منطبق |
