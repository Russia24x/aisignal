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
2. **امضا هم فقط از کلیک** — این همان الگوی مثال رسمی `agw-signing-messages` است. اثر خودکارِ `signIn` (نسخه‌های قبلی پروژه) حذف شد چون popup امضا را بدون user gesture باز می‌کرد و مرورگرها (به‌خصوص Safari/Firefox) آن را بلاک می‌کردند. حالا پس از اتصال کیف پول، دکمهٔ «ورود با امضا» با هالهٔ توجه‌برانگیز (pulse-glow) در Header دیده می‌شود و با کلیک آن، popup امضا در پنجرهٔ فعال‌سازی کاربر باز می‌شود — **ریشه‌ای‌ترین راه‌حلِ بلاک‌شدن پاپ‌آپ**.
3. **پیش‌گرم‌سازی (pre-warm) پروایدر**: کلاینت cross-app با اولین استفاده جزئیات پروایدر را از `auth.privy.io` می‌گیرد؛ `useAuth` بلافاصله بعد از mount صدا می‌زند `connector.getProvider()` تا این fetch زودتر انجام شود → پاپ‌آپ اتصال در لحظهٔ کلیک سریع‌تر باز می‌شود (داخل پنجرهٔ activation می‌ماند).
4. **اتصال مجدد خودکار**: wagmi با `ssr: true` ساخته می‌شود و اتصال Privy در localStorage (کلید `privy-caw:{appId}:connection` با انقضا) ذخیره می‌شود — پس از reload صفحه، کیف پول خودکار reconnect می‌شود.
5. **دو آدرس برای هر اتصال**: `useAccount().address` = آدرس **اسمارت‌اکانت (AGW)** و `useGlobalWalletSignerAccount().address` = آدرس **EOA امضاکننده**. ما همیشه با آدرس اسمارت‌اکانت کار می‌کنیم (هویت کاربر).
6. AGW فقط روی Abstract کار می‌کند (SDK chain-agnostic نیست) — با این حال Header اگر chainId متفاوت گزارش شد هشدار شبکهٔ نادرست نشان می‌دهد.
7. `isConnectModalOpen` در نسخه‌های فعلی SDK **وجود ندارد** — استفاده نکنید.

### جریان کامل ورود (login → session)

```
[کلیک «اتصال کیف پول»]  ← user gesture الزامی (popup ۴۴۰×۶۸۰ پرتال باز می‌شود)
        │ login() → popup AGW (اتصال/ساخت کیف پول)
        ▼
useAccount → status: "connected" (address = AGW)
        │ Header دکمهٔ «ورود با امضا» را با هالهٔ pulse-glow نشان می‌دهد
        ▼
[کلیک «ورود با امضا»]  ← user gesture تازه → popup امضا هرگز بلاک نمی‌شود
        │
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

اگر popup باز هم بلاک شود (فقط وقتی کاربر popupها را کاملاً برای سایت قفل
کرده باشد)، پیام `POPUP_BLOCKED` با راهنمای دقیق فعال‌کردن پاپ‌آپ نمایش داده
می‌شود و دکمه برای تلاش مجدد (کلیک تازه) باقی می‌ماند.

---

## ۴. امضای پیام (SIWE رسمی EIP-4361) — الگوی EIP-1271

امضای AGW یک **امضای اسمارت‌اکانت (EIP-1271)** است، نه `personal_sign` سادهٔ EOA:

- ساختار داخلی: امضای EIP-712 با دامنهٔ `{name:"AbstractGlobalWallet", version:"1.0.0"}` و نوع `AGWMessage(bytes32 signedHash)` + کدگذاری validator (`0x74b9ae28…`) — و در صورت استقرارنیافتن بودن اکانت، با **ERC-6492** پیچیده می‌شود.
- بنابراین **راستی‌آزمایی باید مقابل آدرس اسمارت‌اکانت انجام شود** (نه EOA) — دقیقاً همان الگوی کامپوننت رسمی SIWE در build.abs.xyz:

```ts
// سرور — src/lib/security/siwe.ts (الگوی رسمی)
const valid = await chainClient.verifySiweMessage({
  message,    // پیام EIP-4361 کامل (سرور ساخته)
  signature,  // امضای برگشتی کیف پول
  blockTag: "latest", // پشتیبانی EIP-1271 اسمارت‌والت‌ها (AGW)
});
```

`viem` خودش تشخیص می‌دهد که در آدرس قرارداد وجود دارد → `isValidSignature` (EIP-1271) را صدا می‌زند و برای اکانت‌های استقرارنیافته از verifier ERC-6492 (`0xfB688330…`) استفاده می‌کند. **ecRecover دستی ممنوع** — امضا ساختار EIP-712/1271 دارد و بازیابی سادهٔ کلید نتیجهٔ اشتباه می‌دهد.

### فلو رسمی (کاملاً منطبق با کامپوننت رسمی SIWE دات build.abs.xyz)

| مرحله | ما | مرجع رسمی |
|---|---|---|
| تولید nonce | `generateSiweNonce()` از `viem/siwe` (۹۶ کاراکتر) | همان تابع رسمی |
| ساخت پیام | `createSiweMessage()` از `viem/siwe` با domain/address/statement/URI/version/chainId/nonce/issuedAt/expirationTime — **سمت سرور** (سخت‌گیرانه‌تر از نمونهٔ رسمی که کلاینت می‌سازد) | همان تابع رسمی |
| امضا | `signMessageAsync({ message })` فقط از کلیک | الگوی رسمی |
| ارسال | `POST /api/auth/verify { message, signature }` | همان شکل رسمی |
| پارس | `parseSiweMessage()` + `validateSiweMessage()` | همان توابع رسمی |
| اعتبارسنجی زنجیره | `siwe.chainId === 2741` وگرنه `INVALID_CHAIN` | همان چک رسمی |
| اعتبارسنجی دامنه | `siwe.domain` ∈ {APP_URL host، Host درخواست} وگرنه `INVALID_DOMAIN` (ضد replay بین‌دامنه‌ای) | همان چک رسمی (+ سازگار با گیت‌وی) |
| انقضای پیام | `expirationTime` در آینده (سقف ۲۴ ساعت) | همان چک رسمی (با TTL کوتاه‌تر: ۱۰ دقیقه) |
| راستی‌آزمایی امضا | `verifySiweMessage({ blockTag: 'latest' })` | همان تابع رسمی |
| nonce | ذخیره در **DB** (یک‌بارمصرف + TTL + اتصال به آدرس) — سخت‌گیرانه‌تر از session-cookie نمونهٔ رسمی، سازگار با D1 | ارتقای امنیتی ما |

محتوای پیام: فرمت استاندارد کامل EIP-4361 — دامنه، آدرس، بیانیه، URI، نسخه، Chain ID، nonce (یک‌بارمصرف، TTL ۱۰ دقیقه)، Issued At، Expiration Time. پیام **کاملاً توسط سرور ساخته می‌شود**؛ کلاینت فقط آن را به کیف پول می‌دهد.

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
| کلیک «اتصال» هیچ پنجره‌ای باز نمی‌کند | popup blocker مرورگر (به‌خصوص اولین اتصال که fetch اولیه SDK طول می‌کشد) | اجازهٔ popup به سایت بدهید؛ دوباره کلیک کنید. پیام `POPUP_BLOCKED` دقیقاً همین را می‌گوید. جزئیات پروایدر حالا در بارگذاری صفحه از مبدأ خودمان پیش‌گرم می‌شود و پاپ‌آپ فوراً باز می‌شود | 
| **در شبکهٔ فیلترشده (مثل ایران) هیچ پاپ‌آپی (اتصال/امضا/پرداخت) باز نمی‌شود و «هیچ اتفاقی نمی‌افتد»** | تنها وابستگی شبکه‌ای SDK به دامنهٔ `auth.privy.io` است: سند کوچک و **عمومیِ** جزئیات پروایدر (فقط آدرس‌های پاپ‌آپ portal.abs.xyz را می‌گوید) قبل از هر popup باید واکشی شود؛ اگر آن دامنه در شبکهٔ کاربر مسدود باشد، پاپ‌آپ هرگز باز نمی‌شود و SDK تا ۲ دقیقه بی‌صدا hang می‌کند | **رفع ریشه‌ای (مستقل از privy.io):** ۱) مسیر همان‌مبدأ `/api/agw/details` (پروکسی سرور با کش ۱ساعته + fallback به ثابت‌های باندل‌شده)؛ ۲) پل `lib/agw-bridge.ts` سند را در بارگذاری صفحه پیش‌گرم کرده و به SDK از کشِ درون‌حافظه‌ای در ~۰ms می‌دهد — زنجیرهٔ حل: کش → priming → مستقیم (تایم‌اوت کوتاه) → پروکسی همان‌مبدأ → ثابت‌های باندل؛ ۳) `popupOpenGuard` اگر پنجره‌ای واقعاً باز نشد ظرف ~۲.۵ ثانیه با پیام دقیق fail می‌کند (نه سکوت ۲ دقیقه‌ای) |
| **بعد از اتصال، هدر چیزی نشان نمی‌دهد که کیف «وصل» است تا reload** | دکمهٔ حالت «وصل ولی بی‌سشن» قبلاً فقط «ورود با امضا» بود — بدون آدرس؛ کاربر نمی‌فهمید کیف متصل شده | سرورِ مشترک `AuthProvider` وضعیت را live به همهٔ بخش‌ها می‌رساند **و** هدر حالا همان لحظهٔ اتمام پاپ‌آپ آواتار پروفایل + آدرس کوتاه را کنار «ورود با امضا» نشان می‌دهد — اتصال بدون refresh قابل دیدن است |
| **«Runtime TypeError: Failed to fetch» (خطای اورلی dev)** | fetch اولیهٔ جزئیات پروایدر AGW (auth.privy.io) در شبکه‌های ناپایدار رد می‌شود و SDK آن را unhandled رها می‌کند (wagmi داخل `createConfig` همیشه `connector.setup()` را بدون catch صدا می‌زند) | **رفع ریشه‌ای:** پل `lib/agw-bridge.ts` سند جزئیات را با زنجیرهٔ حل (کش → پروکسی همان‌مبدأ → ثابت‌های باندل) عملاً شکست‌ناپذیر کرده — درخواست دیگر اصلاً reject نمی‌شود؛ گارد `unhandledrejection` هم به‌عنوان ایمنی باقی مانده است |
| **کیف را از هدر وصل می‌کنم ولی بقیهٔ بخش‌ها هنوز «وصل نشده» می‌گویند تا reload کنم** | ۱) `entitlements` فقط یک‌بار در mount واکشی می‌شد و با وصل‌شدن کیف دوباره چک نمی‌شد؛ ۲) اگر مسیر زندهٔ postMessage پاپ‌آپ گم شود، wagmi تا reload متوجه اتصال نمی‌شود | **رفع ریشه‌ای:** ۱) `useAuth` حالا با هر تغییر اکانت (`address`) سشن را refresh می‌کند؛ ۲) connection watcher پل AGW بعد از هر `login()` اتصال ذخیره‌شده را poll می‌کند و wagmi را بدون reload sync می‌کند؛ ۳) متن گیت‌ها حالت واقعی را نشان می‌دهد (وصل = «پیام ورود را امضا کنید»، نه «کیف را وصل کنید») |
| **روی پلن کلیک می‌کنم و هیچ اتفاقی نمی‌افتد** | `signIn()`/`login()` قبلاً fire-and-forget بودند و خطا (مثلاً همین قطعی auth.privy.io) بی‌صدا می‌مرد | **رفع ریشه‌ای:** هر دو مسیر حالا promise دارند و هر خطا بلافاصله toast فارسی/انگلیسی‌شده نشان می‌دهند (`wallet.error.*`) — هیچ مرحله‌ای از زنجیرهٔ auth بی‌بازخورد نیست |
| «Request timed out» | popup بیش از ۲ دقیقه بدون پاسخ ماند | دوباره تلاش کنید؛ اتصال اینترنت/پرتال را چک کنید |
| popup باز می‌شود ولی امضا نمی‌آید | درخواست در سمت پرتال pend ماند | بستن popup = رد (`SIGNATURE_REJECTED`)؛ تلاش مجدد |
| **امضا را در پاپ‌آپ تأیید می‌کنم ولی «هیچ اتفاقی نمی‌افتد»** | اپ داخل iframe (پنل پیش‌نمایش) اجرا شده و مرورگر کوکی `SameSite` سشن را در زمینهٔ cross-site مسدود می‌کند — سشن سمت سرور برقرار شده ولی به UI نمی‌رسد | **رفع ریشه‌ای:** سشن دو حالته — سرور همان توکن HMAC را در پاسخ verify برمی‌گرداند و کلاینت آن را در localStorage نگه داشته و با هدر `Authorization: Bearer` می‌فرستد (`lib/client-session.ts`). کوکی هم روی HTTPS با `SameSite=None; Secure` ست می‌شود. عیب‌یابی: در کنسول `[auth] session mode: cookie|bearer` را ببینید |
| تراکنش send می‌شود ولی fail می‌شود | **ETH صفر برای کارمزد** یا slippage/موجودی PENGU | موجودی ETH و PENGU را در دیالوگ ببینید؛ از پرتال ETH تهیه کنید |
| `TX_NOT_FOUND` هنگام verify | هش غلط/هنوز ماین نشده روی Abstract | چند ثانیه بعد دوباره (اگر pending باشد خودکار 202 می‌آید) |
| `TX_ALREADY_USED` | این هش قبلاً اعتبار داده شده | هر پرداخت فقط یک‌بار قابل استفاده است (replay protection) |
| `NO_QUALIFYING_TRANSFER` | مبلغ/گیرنده/فرستنده با پاس انتخابی نمی‌خواند | مبلغ ≥ قیمت پاس و از همان کیف پولِ سشن فرستاده شود |
| بعد از reload، داشبورد هست ولی کیف پول وصل نیست | انقضای اتصال محلی Privy در برابر سشن ۷روزه — دو چرخهٔ عمر جدا هستند | طبیعی است: سشن سرور (کوکی یا توکن) تا انقضا معتبر است و داشبورد کار می‌کند؛ برای عملیات زنجیره‌ای (امضا/پرداخت) دوباره «اتصال کیف پول» بزنید |

---

## ۹. چک‌لیست انطباق با مستندات رسمی (خلاصهٔ ممیزی)

| مورد | وضعیت |
|---|---|
| Provider رسمی + chain از `viem/chains` | ✅ منطبق |
| `login()` فقط در کلیک‌هندلر | ✅ منطبق |
| **امضا فقط از کلیک (الگوی مثال رسمی agw-signing-messages) — بدون signIn خودکار از effect** | ✅ رفع ریشه‌ای بلاک‌شدن پاپ‌آپ |
| **پیش‌گرم‌سازی پروایدر AGW بعد از mount (fetch auth.privy.io)** | ✅ اضافه شد + **پل شبکهٔ AGW: پروکسی همان‌مبدأ `/api/agw/details` + پیش‌گرم‌سازی کش + زنجیرهٔ fallback (مستقیم → پروکسی → ثابت‌های باندل) + گارد unhandled rejection + connection watcher + popupOpenGuard (`lib/agw-bridge.ts`, `lib/agw-details.ts`)** |
| **بازخورد بصری برای هر شکست auth (toast متمرکز در useAuth — بدون گام بی‌صدا)** | ✅ اضافه شد |
| **SIWE کاملاً رسمی EIP-4361: `generateSiweNonce` + `createSiweMessage` + `parseSiweMessage` + `validateSiweMessage` + `verifySiweMessage` از `viem/siwe`** | ✅ مهاجرت کامل (این بازبینی — طبق build.abs.xyz/docs/authentication/siwe-button) |
| **اعتبارسنجی chain + domain + expirationTime روی پیام امضاشده (ضد replay بین‌دامنه‌ای — چک‌های رسمی)** | ✅ اضافه شد (INVALID_CHAIN / INVALID_DOMAIN / MESSAGE_EXPIRED) |
| امضا با `signMessageAsync` و راستی‌آزمایی EIP-1271 مقابل آدرس اسمارت‌اکانت | ✅ منطبق |
| nonce یک‌بارمصرف (DB-backed) + پیام ساخته‌شده توسط سرور | ✅ منطبق (سخت‌گیرانه‌تر از نمونهٔ رسمی) |
| **بالانس کیف پول در هدر (الگوی رسمی ConnectWalletButton)** | ✅ اضافه شد (PENGU + ETH در دراپ‌داون) |
| ERC-20 `transfer` با `erc20Abi` + `parseUnits(…, 18)` | ✅ منطبق |
| انتظار رسید با `useWaitForTransactionReceipt` | ✅ منطبق (+ تأیید خودکار) |
| راستی‌آزمایی سرور: receipt + لاگ Transfer + replay protection | ✅ منطبق |
| هشدار ETH-for-gas (تراکنش‌ها اسپانسر نیستند) | ✅ اضافه شد |
| مدیریت خطاهای popup (4001 / بلاک / تایم‌اوت) | ✅ اضافه شد |
| wagmi روی v2 (نه v3) | ✅ |
| آدرس PENGU رسمی + ۱۸ اعشار | ✅ راستی‌آزمایی روی زنجیره |
| آدرس‌های abscan.org / abs.xyz | ✅ منطبق |
| AbstractProfile با tier رنگی (الگوی رسمی Abstract Profile) | ✅ منطبق (build.abs.xyz/docs/abstract-portal/abstract-profile) |
