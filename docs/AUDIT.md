# گزارش ممیزی کامل — PenguSignals

**دامنهٔ ممیزی:** کل پروژه (بک‌اند، فرانت‌اند، بلاکچین، امنیت، مستندسازی) با محوریت درخواست کاربر: اتصال کیف پول، پاپ‌آپ/مودال، تراکنش‌ها — با راستی‌آزمایی مقابل **مستندات رسمی Abstract/AGW**.

**روش:** (۱) مطالعهٔ ~۲۵ صفحهٔ رسمی docs.abs.xyz/build.abs.xyz + سورس SDK + RPC زنده؛ (۲) بازبینی خط‌به‌خط کد wallet/auth/payment؛ (۳) رفع یافته‌ها؛ (۴) QA با مرورگر واقعی (agent-browser) + بازبینی بصری VLM.

---

## الف) انطباق با مستندات رسمی — یافته‌های مثبت ✅

| # | مورد | مدرک رسمی | وضعیت کد |
|---|---|---|---|
| 1 | Provider رسمی AGW (`AbstractWalletProvider` + chain از `viem/chains` + `http()`) | docs.abs.xyz/…/AbstractWalletProvider | ✅ `providers.tsx` دقیقاً منطبق |
| 2 | `login()` فقط در کلیک‌هندلر (الزام user-activation برای popup) | سورس cross-app-connect | ✅ `Header` → onClick |
| 3 | امضای پیام با `signMessageAsync` | docs (signMessage: «Alternatively, use Wagmi useSignMessage») | ✅ `useAuth` |
| 4 | راستی‌آزمایی امضا مقابل **آدرس اسمارت‌اکانت** (EIP-1271 + ERC-6492 برای اکانت استقرارنیافته) | مثال رسمی agw-signing-messages | ✅ `siwe.ts` با `chainClient.verifyMessage` |
| 5 | nonce یک‌بارمصرف + پیام ساخته‌شده توسط سرور + پنجرهٔ زمانی | بهترین‌practice SIWE | ✅ |
| 6 | تراکنش ERC-20 با `erc20Abi.transfer` + `parseUnits(…, 18)` | docs (writeContract) + خواندن on-chain `decimals()` | ✅ `PaymentDialog` |
| 7 | آدرس PENGU `0x9eBe…Ba62` با ۱۸ اعشار | راستی‌آزمایی on-chain (name/symbol/decimals) | ✅ `public-config` |
| 8 | Verify سرور: receipt `status==="success"` + لاگ Transfer (topic `0xddf252ad…`) + from/to/token/amount + replay protection | docs + محاسبهٔ مجدد event selector با viem | ✅ `payments.ts` |
| 9 | Explorer `abscan.org` (address/tx) و پرتال `abs.xyz` | docs.abs.xyz/tooling/block-explorers | ✅ |
| 10 | نسخه‌ها: agw-react 1.13.0 (آخرین) · wagmi v2 (مطابق peer `^2.17.5`) · viem 2.56.0 | npm + changelog رسمی | ✅ بدون نیاز به تغییر |

## ب) مشکلات یافت‌شده و رفع‌شده در این ممیزی 🔧

| # | مشکل | ریشه | رفع |
|---|---|---|---|
| 1 | **خطاهای popup طبقه‌بندی نمی‌شدند** — رشته‌های SDK (`"Failed to initialize request"` = popup بلاک، `"Request timeout"` = تایم‌اوت ۲ دقیقه، `"User rejected request"` خام) همه به «NETWORK» گمراه‌کننده می‌رفتند | رفتار popup SDK (سورس‌verified) اما مستند نشده در docs | کدهای پایدار جدید `POPUP_BLOCKED` و `TIMEOUT` در `useAuth` + پوشش هر دو املای «reject» + کلیدهای i18n fa/en |
| 2 | **بی‌خبری از کارمزد ETH** — انتقال‌های ERC-20 روی Abstract اسپانسر نمی‌شوند (فقط استقرار کیف پول paymaster دارد)؛ کاربرِ PENGU-دار ولی بدون ETH می‌توانست وارد تراکنشِ محکوم‌به‌شکست شود | FAQ رسمی | ردیف «کارمزد شبکه (ETH)» در خلاصهٔ دیالوگ + هشدار قرمز اگر ETH=0 |
| 3 | **`TX_PENDING` کد مرده بود** — route وضعیت 202 داشت ولی lib هرگز TX_PENDING برنمی‌گرداند (رسیدِ pend هم TX_NOT_FOUND می‌شد و کاربر «پیدا نشد» اشتباهی می‌دید) | viem برای tx ناماین‌شده هم throw می‌کند | `inspectTransfer` الان `getTransaction` را می‌کاود: tx موجود بدون رسید → `TX_PENDING` (202) |
| 4 | **تأیید دستی اضافه** — با وجود رسیدِ موفقِ زنجیره، کاربر باز هم باید «تأیید» می‌زد | UX | auto-verify با `useWaitForTransactionReceipt` (دوبار اجرا نشود — رفرنس گارد)؛ دکمهٔ دستی فقط fallback |
| 5 | **مسیر «قبلاً پرداخت کرده‌اید» وجود نداشت** — ورود هش دستی فقط بعد از ارسالِ ناموفق ظاهر می‌شد؛ کاربری که از کیف پرتال پرداخت کرده بود راهی نداشت | UX | لینک «قبلاً پرداخت کرده‌اید؟» در فاز idle → فرم هش + «تأیید پرداخت» |
| 6 | **باگ فاز بعد از verify ناموفق دستی** — phase به `sent` می‌رفت و UI نامربوط (step-2 بدون تراکنش) نشان می‌داد | منطق اشتباه در catch/else | بازگشت به `idle` + فرم دستی باز می‌ماند (فقط اگر هش wallet-sent بود step-2) |
| 7 | **`wallet.wrongNetwork` کلید مرده** — هیچ چک chainId در Header نبود | — | قرص هشدار `#chainId` وقتی وصل ولی روی زنجیرهٔ دیگر |
| 8 | **دکمهٔ verify قبل از رسید فعال بود** → کاربر کلیک می‌زد → TX_NOT_FOUND بی‌مورد | UX | دکمه تا رسیدِ تراکنشِ wallet-sent غیرفعال (هش دستی استثنا) + نشانگر «در انتظار تأیید شبکه» / «تأیید شد» |

**رفع‌های دوره‌های قبل** (خلاصه؛ جزئیات در worklog): RATE_LIMITED ورود (سقف 30/min + no-throw + توست)، تعرفهٔ v3 متعادل (۱۰/روز + پلکان تا ۳۰٪)، نشت سیگنال امروز از history (`day < today`)، پنل کیف پول v2.

## ج) موارد بررسی‌شده و سالم (بدون نیاز به تغییر)

- **سشن HMAC**: sign با secret، compare timing-safe، exp در payload، httpOnly/lax/secure — ✅
- **Rate limiter**: پنجرهٔ لغزان + سقف حافظه ۱۰k + retry-after — ✅ (محدودیت multi-instance مستند شد)
- **زودگذری state کلاینت**: هیچ تصمیم امنیتی‌ای از کلاینت نمی‌آید (قیمت/دسترسی/پرداخت همه سرور) — ✅
- **Edge case سشنِ بدون کیف پول متصل**: Header سالم می‌ماند (شاخهٔ اول wallet-status)؛ داشبورد از سشن سرور رندر می‌شود — ✅ تست شد
- **scripts مهاجرت legacy**: idempotent — ✅
- **ws-ticker**: polling تطبیقی + REST fallback سه‌لایه — ✅ (محدودیت sandbox مستند)

## د) نتایج تست عملکرد (agent-browser + VLM)

| تست | نتیجه |
|---|---|
| لود صفحهٔ اصلی (بدون سشن) — رندر، بدون خطای کنسول/صفحه | ✅ PASS |
| گرید تعرفه: ۰ / ۱۰ / ۶۳ / ۲۴۰ / ۲,۵۵۵ / ۵,۱۱۰ + بج‌های تخفیف ۰/۱۰/۲۰/۳۰٪ | ✅ PASS (همهٔ اعداد روی DOM) |
| قیمت زندهٔ تیکر (REST fallback فعال) | ✅ $0.00943 |
| سشن forged (HMAC سرور) → داشبورد احراز هویت‌شده + پنل کیف پول | ✅ PASS |
| باز شدن دیالوگ پرداخت + ردیف کارمزد ETH + گیرنده | ✅ PASS |
| مسیر «قبلاً پرداخت کرده‌اید؟» → ورود هش → تأیید → خطای بومی‌سازی‌شده | ✅ PASS — سرور: 400 INVALID_BODY برای هش غلط‌طول، **404 TX_NOT_FOUND با رفت‌وبرگشت واقعی RPC (1.5s)** برای هش صحیح‌فرمتِ ناموجود |
| باگ فاز (رفت به step-2 بعد از خطای دستی) | ✅ رفع شد — فرم باز ماند، خطا: «تراکنش روی زنجیره Abstract پیدا نشد…» |
| overflow افقی موبایل 390px | ✅ صفر (scrollW == innerW) |
| بازبینی بصری VLM دیالوگ (خلاصه/فرم/خطا/RTL) | ✅ PASS/PASS/PASS |
| lint (eslint) و tsc روی src/ | ✅ صفر خطا |

اسکرین‌شات‌ها: `qa-manual-path.png`، `qa-home-desktop.png`، `qa-home-mobile.png` (ریشهٔ ریپو).

## هـ) ریسک‌های باز و توصیه‌ها (اولویت‌بندی)

1. **[پایین] Finality نرم** — اعتباردهی با رسید L2 (عرف خرد)؛ برای مبالغ بزرگ پایش batch L1 اضافه شود
2. **[پایین] Rate limiter تک‌instance** — هنگام استقرار multi-isolate → Cloudflare Rate Limiting binding (مسیر مستند)
3. **[پایین] wagmi v3** — وقتی agw-react رسماً سازگار کرد، ارتقا (الان peer `^2.17.5` الزام می‌کند)
4. **[میان] تحویل اعلان هشدار قیمت** — فعلاً only in-app؛ کاندیدای بعدی: Telegram/email
5. **[میان] صفحه‌بندی سابقهٔ سیگنال در UI** — API آماده، UI باید صفحه‌بندی بگیرد
6. **[میان] پنل ادمین** — دید مالکانه روی پرداخت‌ها/کاربران
7. **[بالا فقط برای استقرار]** ws-ticker برای محیط production باید بازطراحی شود (Durable Objects)

## و) جمع‌بندی

پیاده‌سازی کیف پول/امضا/تراکنش پروژه **از پایه با الگوهای رسمی Abstract منطبق** بود (۱۰/۱۰ مورد کلیدی). مشکلات واقعی این دوره از جنس **DX/UX عملی popup و تراکنش** بودند (طبقه‌بندی خطا، کارمزد ETH، فازهای دیالوگ، مسیر پرداخت خارجی) که همگی رفع و با مرورگر تست شدند. مستندات کامل این مجموعه (معماری/امنیت/API/استک/بک/فرانت/کیف پول) در پوشهٔ `docs/` ایجاد شد.
