/**
 * On-chain payment verification for PENGU (ERC-20) transfers on Abstract.
 *
 * Trust model: the client NEVER tells us "I paid". It only submits a tx hash.
 * We verify everything ourselves against the Abstract RPC:
 *   1. receipt exists and status == success
 *   2. an ERC-20 Transfer event log exists where:
 *        token == PENGU contract
 *        to    == treasury address
 *        from  == the authenticated user's wallet
 *        value >= pass price (in token base units)
 *   3. the tx hash has not been credited before (replay protection)
 *
 * Session-key-free BY DESIGN: payments are plain ERC-20 transfers initiated
 * by the user's own wallet — no approvals, no allowances, no session keys,
 * so nothing here is subject to Abstract's session-key review policies.
 * A future session-key autopay would observe its transfers through the same
 * verifyAndCredit() pipeline (see docs/ACCESS-MODEL.md § Future).
 *
 * @module lib/modules/access/payments
 */
import { createPublicClient, http, type PublicClient, type Log } from "viem";
import { serverConfig, publicConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { passById, LIFETIME_GRANT_DAYS } from "./passes";

const log = createLogger("payments");

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

let client: PublicClient | null = null;
function rpc(): PublicClient {
  if (!client) {
    client = createPublicClient({ transport: http(serverConfig.NEXT_PUBLIC_RPC_URL) });
  }
  return client;
}

export interface TransferCheck {
  ok: boolean;
  error?: string;
  amountRaw?: bigint;
  from?: string;
  to?: string;
  blockNumber?: bigint;
}

/** Inspect a receipt for a qualifying PENGU transfer to the treasury. */
async function inspectTransfer(
  txHash: string,
  expectedFrom?: string,
  minAmountRaw?: bigint,
): Promise<TransferCheck> {
  let receipt;
  try {
    receipt = await rpc().getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return { ok: false, error: "TX_NOT_FOUND" };
  }

  if (receipt.status !== "success") return { ok: false, error: "TX_FAILED" };

  const pengu = publicConfig.penguToken.toLowerCase();
  const treasury = publicConfig.treasury.toLowerCase();

  for (const l of receipt.logs as Log[]) {
    if (l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (l.address.toLowerCase() !== pengu) continue;
    const from = "0x" + (l.topics[1] ?? "").slice(26);
    const to = "0x" + (l.topics[2] ?? "").slice(26);
    if (to.toLowerCase() !== treasury) continue;
    if (expectedFrom && from.toLowerCase() !== expectedFrom.toLowerCase()) continue;
    const value = BigInt(l.data === "0x" ? 0 : l.data);
    if (minAmountRaw && value < minAmountRaw) continue;
    return { ok: true, amountRaw: value, from, to, blockNumber: receipt.blockNumber };
  }
  return { ok: false, error: "NO_QUALIFYING_TRANSFER" };
}

export const PENGU_DECIMALS = 18;

/** Convert human PENGU amount to base units (18 decimals). */
export function toBaseUnits(amount: number): bigint {
  const [int, frac = ""] = amount.toFixed(18).split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(int + fracPadded);
}

/** Convert base units to human PENGU amount. */
export function fromBaseUnits(raw: bigint): number {
  return Number(raw) / 1e18;
}

export interface VerifyPaymentResult {
  ok: boolean;
  error?: string;
  amountToken?: number;
  txHash?: string;
}

/**
 * Full payment verification + crediting pipeline for access passes.
 *
 * Every product is a time pass: the grant extends from the later of
 * (now, current active expiry) so early renewals never lose paid days.
 * PASS_LIFETIME grants ≈100 years — practically forever.
 */
export async function verifyAndCredit(params: {
  txHash: string;
  userAddress: string;
  product: string;
  expectedPrice: number;
}): Promise<VerifyPaymentResult> {
  const { txHash, userAddress, product, expectedPrice } = params;
  const normalized = txHash.toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(normalized)) return { ok: false, error: "INVALID_TX_HASH" };

  const pass = passById(product);
  if (!pass) return { ok: false, error: "UNKNOWN_PRODUCT" };

  // replay protection
  const existing = await db.payment.findUnique({ where: { txHash: normalized } });
  if (existing) return { ok: false, error: "TX_ALREADY_USED" };

  const minRaw = toBaseUnits(expectedPrice);
  const check = await inspectTransfer(normalized, userAddress, minRaw);
  if (!check.ok) return { ok: false, error: check.error };

  const amountToken = fromBaseUnits(check.amountRaw!);

  // find the user record
  const user = await db.user.findUnique({ where: { address: userAddress.toLowerCase() } });
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };

  // record payment + grant access atomically
  const now = new Date();
  const grantDays = pass.days ?? LIFETIME_GRANT_DAYS;
  const result = await db.$transaction(async (tx) => {
    // double-check uniqueness inside the transaction
    const dupe = await tx.payment.findUnique({ where: { txHash: normalized } });
    if (dupe) throw new Error("TX_ALREADY_USED");

    const payment = await tx.payment.create({
      data: {
        txHash: normalized,
        chainId: serverConfig.NEXT_PUBLIC_CHAIN_ID,
        fromAddress: userAddress.toLowerCase(),
        toAddress: publicConfig.treasury,
        token: publicConfig.penguToken,
        amountRaw: check.amountRaw!.toString(),
        amountToken,
        product,
        status: "VERIFIED",
        blockNumber: check.blockNumber ?? null,
        userId: user.id,
      },
    });

    // all passes stack: extend from the later of (now, current expiry)
    const active = await tx.accessGrant.findFirst({
      where: { userId: user.id, expiresAt: { gt: now } },
      orderBy: { expiresAt: "desc" },
    });
    const base = active ? active.expiresAt : now;
    await tx.accessGrant.create({
      data: {
        userId: user.id,
        product,
        startsAt: now,
        expiresAt: new Date(base.getTime() + grantDays * 24 * 3600 * 1000),
        sourcePaymentId: payment.id,
      },
    });
    return payment;
  });

  log.info("payment credited", { txHash: normalized, product, amountToken, userId: user.id });
  return { ok: true, amountToken, txHash: result.txHash };
}
