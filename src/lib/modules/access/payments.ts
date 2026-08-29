/**
 * On-chain payment verification — STATELESS, multi-token (target plan §7, §10).
 *
 * Trust model: the client NEVER tells us "I paid". It only submits a tx hash
 * (+ the product it intends to buy, and for non-PENGU tokens the signed
 * quote it was shown). We verify everything ourselves against the Abstract RPC:
 *
 *   1. receipt exists and status == success
 *   2. the qualifying transfer exists:
 *        ERC-20  → Transfer log where token == registry token,
 *                  to == treasury, from == the session wallet,
 *                  value ≥ required amount
 *        native  → tx.value ≥ quoted ETH amount AND tx.to == treasury
 *   3. the product's price requirement is met:
 *        PENGU   → exact catalog price (prices ARE PENGU-denominated)
 *        others  → HMAC-SIGNED QUOTE (fresh, product-bound) — no DB needed
 *                  to remember what was quoted
 *
 * NO replay database: entitlements derive from the PAYMENT BLOCK TIMESTAMP
 * (expiry = blockTime + plan duration), so replaying an old tx can never
 * mint a future-dated pass — the chain itself is the ledger.
 *
 * @module lib/modules/access/payments
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createPublicClient, http, type PublicClient, type Log } from "viem";
import { serverConfig, publicConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { passById, isLifetimePass, LIFETIME_GRANT_DAYS, DAY_MS } from "./passes";
import { payTokenByKey, payTokenByAddress, toBaseUnits, fromBaseUnits, TRANSFER_TOPIC, type PayTokenKey } from "./tokens";
import type { EntitlementClaim } from "@/lib/security/session";

const log = createLogger("payments");

let client: PublicClient | null = null;
function rpc(): PublicClient {
  if (!client) {
    client = createPublicClient({ transport: http(serverConfig.NEXT_PUBLIC_RPC_URL) });
  }
  return client;
}

/* ------------------------------------------------------------------ */
/* Signed quotes (non-PENGU tokens)                                    */
/* ------------------------------------------------------------------ */

export interface SignedQuote {
  product: string;
  token: PayTokenKey;
  /** human amount in the quote token */
  amountToken: number;
  quotedAt: number;
  sig: string;
}

function quoteMac(product: string, token: string, amountRaw: string, quotedAt: number): string {
  return createHmac("sha256", serverConfig.SESSION_SECRET)
    .update(`${product}|${token}|${amountRaw}|${quotedAt}`)
    .digest("base64url");
}

/** Build a signed quote for a product in a non-PENGU token. */
export function buildQuote(product: string, token: PayTokenKey, amountToken: number, decimals: number): SignedQuote {
  const quotedAt = Date.now();
  const amountRaw = toBaseUnits(amountToken, decimals).toString();
  return {
    product,
    token,
    amountToken,
    quotedAt,
    sig: quoteMac(product, token, amountRaw, quotedAt),
  };
}

/** Constant-time MAC comparison (same pattern as session.ts). */
function macEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Verify a signed quote: our MAC, right product/token, fresh enough. */
function verifyQuote(
  quote: SignedQuote,
  product: string,
  token: PayTokenKey,
): { ok: boolean; amountRaw: bigint | null } {
  if (!quote || typeof quote !== "object") return { ok: false, amountRaw: null };
  if (quote.product !== product || quote.token !== token) return { ok: false, amountRaw: null };
  const age = Date.now() - Number(quote.quotedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > serverConfig.PAYMENT_QUOTE_TTL_MS) {
    return { ok: false, amountRaw: null };
  }
  // recompute the MAC from the declared amount
  const decimals = payTokenByKey(token)?.decimals ?? 18;
  const amountRaw = toBaseUnits(Number(quote.amountToken), decimals);
  const expected = quoteMac(product, token, amountRaw.toString(), Number(quote.quotedAt));
  if (!macEquals(expected, quote.sig)) return { ok: false, amountRaw: null };
  return { ok: true, amountRaw };
}

/* ------------------------------------------------------------------ */
/* Receipt inspection                                                  */
/* ------------------------------------------------------------------ */

export interface TransferCheck {
  ok: boolean;
  error?: string;
  amountRaw?: bigint;
  token?: PayTokenKey;
  from?: string;
  to?: string;
  blockNumber?: bigint;
  /** filled by the native-transfer inspector (saves one RPC round-trip) */
  blockTimestampMs?: number;
}

/** Inspect a receipt for a qualifying ERC-20 transfer to the treasury. */
async function inspectErc20Transfer(
  txHash: string,
  expectedFrom: string,
): Promise<TransferCheck> {
  const receipt = await getReceipt(txHash);
  if (!receipt.ok) return receipt;

  const treasury = publicConfig.treasury.toLowerCase();
  for (const l of receipt.receipt!.logs as Log[]) {
    if (l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const token = payTokenByAddress(l.address);
    if (!token) continue;
    const from = "0x" + (l.topics[1] ?? "").slice(26);
    const to = "0x" + (l.topics[2] ?? "").slice(26);
    if (to.toLowerCase() !== treasury) continue;
    if (from.toLowerCase() !== expectedFrom.toLowerCase()) continue;
    const value = BigInt(l.data === "0x" ? 0 : l.data);
    return { ok: true, amountRaw: value, token: token.key, from, to, blockNumber: receipt.receipt!.blockNumber };
  }
  return { ok: false, error: "NO_QUALIFYING_TRANSFER" };
}

/** Inspect a receipt for a qualifying native-ETH transfer to the treasury. */
async function inspectNativeTransfer(
  txHash: string,
  expectedFrom: string,
): Promise<TransferCheck> {
  const receipt = await getReceipt(txHash);
  if (!receipt.ok) return receipt;

  const [tx, block] = await Promise.all([
    rpc().getTransaction({ hash: txHash as `0x${string}` }),
    rpc().getBlock({ blockNumber: receipt.receipt!.blockNumber }),
  ]);
  const treasury = publicConfig.treasury.toLowerCase();
  if ((tx.to ?? "").toLowerCase() !== treasury) return { ok: false, error: "NO_QUALIFYING_TRANSFER" };
  if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) {
    return { ok: false, error: "NO_QUALIFYING_TRANSFER" };
  }
  return {
    ok: true,
    amountRaw: tx.value,
    token: "ETH",
    from: tx.from,
    to: tx.to ?? "",
    blockNumber: receipt.receipt!.blockNumber,
    blockTimestampMs: Number(block.timestamp) * 1000,
  };
}

interface ReceiptResult {
  ok: boolean;
  error?: string;
  receipt?: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
}

async function getReceipt(txHash: string): Promise<ReceiptResult> {
  try {
    const receipt = await rpc().getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== "success") return { ok: false, error: "TX_FAILED" };
    return { ok: true, receipt };
  } catch {
    // viem throws TransactionReceiptNotFoundError both for unknown hashes
    // and for txs that are known but not yet mined. Distinguish them so the
    // client can show "pending" (202) instead of a misleading "not found".
    try {
      const tx = await rpc().getTransaction({ hash: txHash as `0x${string}` });
      if (tx) return { ok: false, error: "TX_PENDING" };
    } catch {
      /* tx unknown on this chain → fall through */
    }
    return { ok: false, error: "TX_NOT_FOUND" };
  }
}

/* ------------------------------------------------------------------ */
/* Full verification pipeline                                          */
/* ------------------------------------------------------------------ */

export interface VerifyPaymentResult {
  ok: boolean;
  error?: string;
  amountToken?: number;
  token?: PayTokenKey;
  /** mint-ready entitlement derived from the payment block timestamp */
  entitlement?: {
    product: string;
    expiresAt: number; // epoch ms
    lifetime: boolean;
    txHash: string;
    /** block timestamp of the payment (replay guard for future verifies) */
    paidAt: number;
  };
}

/**
 * Verify a payment and derive the entitlement — no storage anywhere.
 *
 * REPLAY GUARD (stateless): the current claim records `paidAt` (the block
 * timestamp of the newest payment already consumed). A submitted payment
 * only mints/extends when it is STRICTLY NEWER than the claim's paidAt (or
 * there is no active claim) — re-submitting the same tx hash can never
 * stack the pass. Old sessions without `paidAt` fail validation and simply
 * re-establish on the next sign-in.
 *
 * @param params.txHash         the payment transaction
 * @param params.userAddress    the session wallet (must be the sender)
 * @param params.product        the product being purchased (PASS_*)
 * @param params.quote          signed quote (required for non-PENGU tokens)
 * @param params.currentClaim   the session's current entitlement claim
 *                              (stacking + replay guard); omit for fresh
 */
export async function verifyPayment(params: {
  txHash: string;
  userAddress: string;
  product: string;
  quote?: SignedQuote;
  currentClaim?: EntitlementClaim | null;
}): Promise<VerifyPaymentResult> {
  const { txHash, userAddress, product, quote, currentClaim } = params;
  const normalized = txHash.toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalized)) return { ok: false, error: "INVALID_TX_HASH" };

  const pass = passById(product);
  if (!pass) return { ok: false, error: "UNKNOWN_PRODUCT" };

  // 1. Inspect the chain — accept either a qualifying ERC-20 transfer or a
  //    native ETH transfer to the treasury from the session wallet.
  let check: TransferCheck;
  check = await inspectErc20Transfer(normalized, userAddress);
  if (!check.ok && check.error === "NO_QUALIFYING_TRANSFER") {
    check = await inspectNativeTransfer(normalized, userAddress);
  }
  if (!check.ok) return { ok: false, error: check.error };

  const tokenKey = check.token!;
  const tokenDef = payTokenByKey(tokenKey);
  if (!tokenDef) return { ok: false, error: "UNSUPPORTED_TOKEN" };

  // 2. Amount requirement per token
  let amountRaw = check.amountRaw!;
  if (tokenKey === "PENGU") {
    // prices are PENGU-denominated → exact catalog price
    const required = toBaseUnits(pass.pricePengu, tokenDef.decimals);
    if (amountRaw < required) return { ok: false, error: "INSUFFICIENT_AMOUNT" };
  } else {
    // non-PENGU → must present a valid signed quote for THIS product+token
    if (!quote) return { ok: false, error: "QUOTE_REQUIRED" };
    const q = verifyQuote(quote, product, tokenKey);
    if (!q.ok || q.amountRaw === null) return { ok: false, error: "QUOTE_INVALID" };
    // tolerate small downward slippage vs the signed quote
    const floor = (q.amountRaw * BigInt(100 - serverConfig.PAYMENT_SLIPPAGE_PCT)) / 100n;
    if (amountRaw < floor) return { ok: false, error: "INSUFFICIENT_AMOUNT" };
  }

  // 3. Payment block timestamp → honest expiry (replay of an old tx can
  //    never mint a future-dated pass)
  const blockTimestampMs = check.blockTimestampMs ?? (await (async () => {
    const block = await rpc().getBlock({ blockNumber: check.blockNumber! });
    return Number(block.timestamp) * 1000;
  })());

  // 4. REPLAY GUARD: only a strictly-newer payment may mint or extend.
  //    Without this, re-submitting one confirmed tx while a pass is active
  //    would stack `currentExpiry + grantDays` on every replay.
  if (currentClaim) {
    const claimActive = currentClaim.lifetime || currentClaim.expiresAt > Date.now();
    if (normalized === currentClaim.txHash || (claimActive && blockTimestampMs <= currentClaim.paidAt)) {
      return { ok: false, error: "TX_ALREADY_USED" };
    }
  }

  const grantDays = pass.days ?? LIFETIME_GRANT_DAYS;
  const stackBase = currentClaim && (currentClaim.lifetime || currentClaim.expiresAt > Date.now())
    ? currentClaim.expiresAt
    : 0;
  const base = Math.max(blockTimestampMs, stackBase);
  const expiresAt = base + grantDays * DAY_MS;

  const amountToken = fromBaseUnits(amountRaw, tokenDef.decimals);
  log.info("payment verified", {
    txHash: normalized,
    product,
    token: tokenKey,
    amountToken,
    expiresAt,
  });

  return {
    ok: true,
    amountToken,
    token: tokenKey,
    entitlement: {
      product,
      expiresAt,
      // once lifetime, always lifetime (a later smaller payment must not
      // downgrade the flag even though it re-mints the claim)
      lifetime: isLifetimePass(product) || !!currentClaim?.lifetime,
      txHash: normalized,
      paidAt: blockTimestampMs,
    },
  };
}
