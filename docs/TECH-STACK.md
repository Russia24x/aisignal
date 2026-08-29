# استک فناوری — PenguSignals

سند مرجع فناوری‌های بکاررفته، نسخه‌ها، دلیل انتخاب و جایگزین‌ها. نسخه‌ها از `package.json` پروژه (قفل‌شده در نصب فعلی).

---

## نمای کلی

| لایه | فناوری | نسخه | چرا |
|---|---|---|---|
| Framework | **Next.js** (App Router) | 16.x | SSR/ISR + API routes در یک سرویس؛ استاندارد اکوسیستم React |
| زبان | **TypeScript** (strict) | 5.x | ایمنی نوع سرتاسری؛ بدون any در کد محصول |
| UI | **React** | 19.x | هم‌گام با Next 16 |
| استایل | **Tailwind CSS** | 4.x | utility-first، طراحی RTL-friendly با logical properties (`ms-`/`me-`) |
| کامپوننت | **shadcn/ui** (پالت New York) + Radix UI | — | کامپوننت‌های accessible و قابل‌کپی؛ Lucide برای آیکون |
| انیمیشن | **framer-motion** | 12.x | ترنزیشن‌های ظریف hover/ظاهرشدن |
| بلاکچین | **Abstract Chain** (L2 zk-rollup، Chain ID 2741) | — | زنجیرهٔ محصول؛ PENGU native |
| کیف پول | **Abstract Global Wallet (AGW)** — `@abstract-foundation/agw-react` | 1.13.0 (آخرین) | SDK رسمی؛ اسمارت‌اکانت با امضای EIP-1271 |
| Web3 کلاینت | **wagmi** (⚠️ v2 — v3 با agw-react فعلی ناسازگار) / **viem** | 2.19.x / 2.56.0 | hooks برای write/read + typed RPC |
| Server state | **TanStack Query** | 5.x | cache/refetch برای دادهٔ زندهٔ بازار |
| دیتابیس | **— هیچ‌کدام** (v4 stateless) | — | کش درون‌حافظه + سشن امضاشده + زنجیره به‌عنوان منبع حقیقت (§9 معماری هدف) |
| اعتبارسنجی | **zod** | 4.x | env + بدنهٔ API در یک الگو |
| Toast | **sonner** | — | بازخورد عملیات (خطاهای ورود/پرداخت) |
| i18n | JSON دوزبانه (`src/i18n/{fa,en}.json`) + provider اختصاصی | — | فارسی RTL + انگلیسی؛ افزودن زبان = یک فایل |
| Runtime | **Bun** (dev) / Node 20+ | 1.1+ | سرعت نصب/dev |

---

## لایهٔ بلاکچین (تفصیلی)

| بسته | نقش |
|---|---|
| `@abstract-foundation/agw-react` 1.13.0 | `AbstractWalletProvider` (می‌پیچد WagmiProvider + QueryClient)، `useLoginWithAbstract`، popup اتصال |
| `wagmi` 2.19.x | `useAccount` / `useBalance` / `useSignMessage` / `useWriteContract` / `useWaitForTransactionReceipt` |
| `viem` 2.56.0 | `abstract` chain، `createPublicClient` (سرور)، `erc20Abi`، `parseUnits`، `verifyMessage` (EIP-1271/ERC-6492)، `checksumAddress` |

ملاحظات نسخه:
- peer requirement رسمی agw-react 1.13: `wagmi ^2.17.5`، `viem ^2.37.0`، `@tanstack/react-query ^5` — همه رعایت شده.
- مخزن قدیمی `Abstract-Foundation/agw-sdk` آرشیو شده؛ خانهٔ فعال: `Abstract-Foundation/abstract-packages`.
- `@abstract-foundation/agw-client` فعلاً dependency گذرا (transitive) است — اگر روزی مستقیم import شد باید direct dependency شود.

---

## معماری سمت کلاینت

- **State سمت سرور**: TanStack Query (بازار، پروفایل پرتال) با staleTime مناسب
- **State سمت کلاینت**: `useState` محلی + contextهای سبک (i18n) — Zustand نصب است ولی استفادهٔ فعال ندارد (template)
- **Providerها** (`src/components/providers.tsx`): `I18nProvider` → `ThemeProvider` (next-themes، دارک پیش‌فرض) → `AbstractWalletProvider` → `Toaster`
- **Hooks اختصاصی**: `useAuth` (پل کیف پول⇄سشن)، `useMarket` (snapshot با polling 60s)، `useAbstractProfile` (پروفایل پرتال)، `useTicker` (WS + REST fallback)

## معماری سمت سرور

- **API Routes** (App Router) — endpointها با الگوی ثابت: rate limit → auth → zod → منطق ماژول → پاسخ `{ok,…}`
- **ماژول‌های دامنه** (`src/lib/modules/`): `market` (داده + cache چند-تایم‌فریمی)، `analysis` (موتور ۵-فاکتوری چند-تایم‌فریمی + سرویس سیگنال stateless)، `access` (passes/tokens/payments/entitlements/restore)
- **امنیت** (`src/lib/security/`): `siwe.ts` (nonce خودامضاشده + verify)، `session.ts` (HMAC cookie + entitlement claim)، `rate-limit.ts` (پنجرهٔ لغزان)
- **Cache**: `TTLCache` درون‌حافظه با stale-while-revalidate (بدون ترافیک = صفر فراخوانی upstream) — snapshot 60s، کندل‌ها per-TF (30/60/120/120s — §13)، تاریخچه 15m، اسکن restore per-wallet 10m
- **تیکر قیمت**: حالت واحد REST — `useMarket` هر ۶۰ ثانیه `/api/market/overview` را می‌گیرد (کش سروری از منابع بالادستی محافظت می‌کند). سرویس socket.io قبلی برای انطباق کامل با لایهٔ رایگان Cloudflare حذف شد

## منابع دادهٔ خارجی (سقف مصرف)

| منبع | نقش | مصرف | سقف مجاز |
|---|---|---|---|
| Binance | قیمت + کندل همه تایم‌فریم‌ها (primary) | ~20/hr اپ (cache per-TF) | 1200 weight/min |
| DexScreener | غنی‌سازی snapshot (نقدینگی/FDV/تغییرات کوتاه) | ≤60/hr اپ (cache 60s) | 300 req/min |
| CoinGecko | fallback کندل + snapshot | ≤6/hr (cross-check هر ۱۰مین snapshot) | demo ~10-30 req/min |
| CoinMarketCap | fallback نهایی (endpoint keyless عمومی) | فقط وقتی هر دو قبلی قطع‌اند | عمومی |
| RPC Abstract | verify سشن/پرداخت + اسکن restore | per-request؛ restore کش 10m per-wallet | عمومی |

## وابستگی‌های نصب‌شدهٔ بلااستفاده

~۱۴ بستهٔ template (`next-auth`، `next-intl`، `zustand`، `mdxeditor`، `dnd-kit`، …) بدون import از هیچ route — در باندل production نمی‌آیند؛ حذف‌شان churn بدون منفعت است (مستند در ممیزی منابع قبلی).

---

## تصمیمات کلیدی و بدیل‌ها

| تصمیم | بدیل ردشده | دلیل |
|---|---|---|
| AGW SDK رسمی | wagmi standalone / privy مستقیم | اسمارت‌اکانت + popup رسمی + EIP-1271 بدون پیاده‌سازی دستی |
| ترانسفر مستقیم برای پرداخت (PENGU/ETH) | Session Keys / approve+pull | خارج از سیاست بازبینی Session Key؛ سادگی و بیشینه‌سازی امنیت برای کاربر |
| **بدون دیتابیس (v4)** | SQLite/D1 + Prisma | معماری هدف: زنجیره = منبع حقیقت؛ بازمحاسبه قطعی تاریخچه قوی‌تر از DB خصوصی است؛ صفر هزینه/نگهداری |
| انقضای پاس از timestamp بلاک | جدول Payment ضد-replay | replay تراکنش قدیمی پاس منقضی می‌دهد نه آینده — بدون هیچ ذخیره‌سازی |
| کوت HMAC-امضاشده برای ETH | نرخ لحظه‌ای موقع verify | قفل نرخ ۳۰ دقیقه‌ای بدون DB؛ ضدجعل با MAC |
| nonce خودامضاشده (HMAC) | جدول Nonce | stateless؛ TTL و binding داخل خود nonce؛ burn حافظه‌ای best-effort (تحلیل در SECURITY.md) |
| HMAC stateless cookie + entitlement claim | JWT + DB session store | بدون سرویس اضافه؛ revoke = چرخش secret |
| Rate limit درون‌حافظه | Redis | صفر وابستگی؛ برای multi-instance مسیر Cloudflare binding مستند است |
| i18n اختصاصی JSON | next-intl | سبک‌تر؛ کنترل کامل RTL و کلیدهای تودرتو |
