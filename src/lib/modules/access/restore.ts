/**
 * On-chain entitlement recovery — "the blockchain is the database"
 * (target plan §9: wallet + verified payment + block timestamp).
 *
 * When a paid user returns (new browser, cleared cookies, new device), the
 * server can reconstruct their entitlement WITHOUT any stored state:
 *
 *   1. eth_getLogs over recent blocks for ERC-20 Transfer events where
 *        token   == a registered pay token (PENGU / enabled ERC-20s)
 *        topics: from == user wallet, to == treasury
 *   2. every found payment is mapped to a pass (largest affordable) and
 *      replayed CHRONOLOGICALLY with stacking semantics:
 *        expiry = max(expiry, blockTime) + planDays
 *      — identical to what verifyPayment would have minted at the time
 *   3. the best entitlement is minted into a fresh session
 *
 * Native-ETH transfers emit no logs, so ETH payments are recovered via the
 * manual txHash path (POST /api/payment/verify with the old hash) — the
 * block-timestamp expiry makes that replay-safe.
 *
 * Scans are chunked (RESTORE_SCAN_CHUNK_BLOCKS) and cached per wallet
 * (RESTORE_CACHE_TTL_MS) so the dashboard and restore buttons stay cheap.
 *
 * @module lib/modules/access/restore
 */
import { createPublicClient, http, numberToHex, type PublicClient, type Log, type Address } from "viem";
import { TTLCache } from "@/lib/cache";
import { serverConfig, publicConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { passForAmount, isLifetimePass, LIFETIME_GRANT_DAYS, DAY_MS } from "./passes";
import { PAY_TOKENS, fromBaseUnits, TRANSFER_TOPIC } from "./tokens";
import type { EntitlementClaim } from "@/lib/security/session";

const log = createLogger("access:restore");

let client: PublicClient | null = null;
function rpc(): PublicClient {
  if (!client) {
    client = createPublicClient({ transport: http(serverConfig.NEXT_PUBLIC_RPC_URL) });
  }
  return client;
}

/** A payment found on-chain (ERC-20 transfers to the treasury). */
export interface OnChainPayment {
  txHash: string;
  token: string;
  amountToken: number;
  blockNumber: number;
  blockTimestamp: number; // ms
}

/** scan results cached per wallet+lookback */
const scanCache = new TTLCache<OnChainPayment[]>(serverConfig.RESTORE_CACHE_TTL_MS);

function topicAddress(addr: string): `0x${string}` {
  return `0x${addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as `0x${string}`;
}

interface GetLogsParams {
  fromBlock: bigint;
  toBlock: bigint;
  address: Address;
  topics: [`0x${string}`, `0x${string}`, `0x${string}`];
}

async function getLogs(params: GetLogsParams): Promise<Log[]> {
  // raw eth_getLogs via the transport (viem's typed getLogs overloads are
  // event-ABI oriented; the raw form here is simpler and exact)
  return (await rpc().request({
    method: "eth_getLogs",
    params: [
      {
        address: params.address,
        topics: params.topics,
        fromBlock: numberToHex(params.fromBlock),
        toBlock: numberToHex(params.toBlock),
      },
    ],
  })) as Log[];
}

/** Timestamp (ms) of a block, memoized for the scan's lifetime. */
const blockTsCache = new Map<bigint, number>();
async function blockTimestamp(blockNumber: bigint): Promise<number> {
  const hit = blockTsCache.get(blockNumber);
  if (hit !== undefined) return hit;
  const block = await rpc().getBlock({ blockNumber });
  const ts = Number(block.timestamp) * 1000;
  if (blockTsCache.size < 2000) blockTsCache.set(blockNumber, ts);
  return ts;
}

/**
 * Scan the chain for ERC-20 pass payments from `wallet` to the treasury.
 * Walks backward in chunks until the lookback cutoff timestamp is passed.
 */
export async function scanPayments(
  wallet: string,
  lookbackDays = serverConfig.RESTORE_SCAN_LOOKBACK_DAYS,
): Promise<OnChainPayment[]> {
  const key = `${wallet.toLowerCase()}:${lookbackDays}`;
  return scanCache.getOrRefresh(key, async () => {
    const t0 = Date.now();
    const treasury = publicConfig.treasury.toLowerCase();
    const from = wallet.toLowerCase();
    const erc20Tokens = PAY_TOKENS.filter((t) => t.enabled && t.kind === "erc20" && t.address);
    const cutoff = Date.now() - lookbackDays * DAY_MS;

    const latest = await rpc().getBlockNumber();
    const chunk = BigInt(serverConfig.RESTORE_SCAN_CHUNK_BLOCKS);

    const found: OnChainPayment[] = [];
    let to = latest;
    let guard = 0;
    while (guard++ < 40) {
      const fromB = to > chunk ? to - chunk : 0n;
      let chunkLogs: Log[] = [];
      for (const token of erc20Tokens) {
        const logs = await getLogs({
          fromBlock: fromB,
          toBlock: to,
          address: token.address as `0x${string}`,
          topics: [TRANSFER_TOPIC, topicAddress(from), topicAddress(treasury)],
        });
        chunkLogs = chunkLogs.concat(logs);
      }
      for (const l of chunkLogs) {
        if (!l.transactionHash || l.blockNumber === null) continue;
        const amountRaw = BigInt(l.data === "0x" ? 0 : l.data);
        const tokenDef = erc20Tokens.find(
          (t) => t.address === l.address.toLowerCase(),
        );
        if (!tokenDef) continue;
        found.push({
          txHash: l.transactionHash.toLowerCase(),
          token: tokenDef.key,
          amountToken: fromBaseUnits(amountRaw, tokenDef.decimals),
          blockNumber: Number(l.blockNumber),
          blockTimestamp: await blockTimestamp(l.blockNumber),
        });
      }
      // stop when this whole chunk is older than the cutoff
      const chunkStartTs = await blockTimestamp(fromB === 0n ? 1n : fromB);
      if (chunkStartTs < cutoff || fromB === 0n) break;
      to = fromB - 1n;
    }
    found.sort((a, b) => a.blockTimestamp - b.blockTimestamp);
    log.info("treasury scan complete", {
      wallet: from,
      payments: found.length,
      lookbackDays,
      ms: Date.now() - t0,
    });
    return found;
  });
}

/**
 * Replay on-chain payments chronologically with stacking semantics and
 * derive the best entitlement — exactly what verifyPayment would have
 * minted for each payment at the time.
 */
export function computeEntitlement(payments: OnChainPayment[]): EntitlementClaim | null {
  let expiry = 0;
  let best: EntitlementClaim | null = null;
  for (const p of payments) {
    const pass = passForAmount(p.amountToken);
    if (!pass) continue; // below the cheapest pass — not a pass payment
    const grantDays = pass.days ?? LIFETIME_GRANT_DAYS;
    expiry = Math.max(expiry, p.blockTimestamp) + grantDays * DAY_MS;
    best = {
      product: pass.id,
      expiresAt: expiry,
      lifetime: isLifetimePass(pass.id),
      txHash: p.txHash,
      mintedAt: Date.now(),
    };
  }
  return best;
}
