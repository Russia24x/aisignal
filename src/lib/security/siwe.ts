/**
 * SIWE-style (Sign-In With Ethereum) authentication for Abstract wallets.
 *
 * Flow:
 *  1. Client requests a nonce:        GET  /api/auth/nonce?address=0x..
 *  2. Client signs a domain-scoped message with the wallet (AGW or EOA).
 *  3. Client posts {address, signature}: POST /api/auth/verify
 *  4. Server verifies signature via viem `verifyMessage` — which transparently
 *     supports EIP-1271 contract signatures (Abstract Global Wallet is a
 *     smart account) — binds & burns the nonce, creates a session.
 *
 * Security: nonce is single-use + expiring; message binds domain, address,
 * nonce and issued-at; verification is entirely server-side.
 *
 * @module lib/security/siwe
 */
import { createHash, randomBytes } from "node:crypto";
import { createPublicClient, http, checksumAddress, isAddress } from "viem";
import type { PublicClient } from "viem";
import { db } from "@/lib/db";
import { serverConfig, publicConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:siwe");
const NONCE_TTL_MS = 5 * 60 * 1000;

/** Public client bound to the configured Abstract chain. */
export const chainClient: PublicClient = createPublicClient({
  transport: http(serverConfig.NEXT_PUBLIC_RPC_URL),
});

export function isValidAddress(addr: string): boolean {
  return typeof addr === "string" && addr.startsWith("0x") && isAddress(addr);
}

export function toChecksum(addr: string): string {
  return checksumAddress(addr as `0x${string}`);
}

/** Issue a single-use nonce (optionally pre-bound to an address). */
export async function issueNonce(address?: string): Promise<{ nonce: string }> {
  // housekeeping: drop expired nonces occasionally
  await db.nonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const nonce = randomBytes(16).toString("hex");
  await db.nonce.create({
    data: {
      nonce,
      address: address?.toLowerCase() ?? null,
      expiresAt: new Date(Date.now() + NONCE_TTL_MS),
    },
  });
  return { nonce };
}

/** Build the exact message the user must sign. */
export function buildAuthMessage(params: {
  address: string;
  nonce: string;
  issuedAt: string;
  statement?: string;
}): string {
  const uri = new URL(publicConfig.appUrl).origin;
  return [
    `${publicConfig.appName} wants you to sign in with your Abstract account:`,
    params.address,
    "",
    `By signing you confirm ownership of this wallet and accept the Terms of Service.`,
    "",
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${publicConfig.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
  ].join("\n");
}

export interface VerifyResult {
  ok: boolean
  error?: string
  address?: string
}

/**
 * Verify an auth payload: nonce validity + signature authenticity.
 */
export async function verifyAuth(params: {
  address: string;
  nonce: string;
  issuedAt: string;
  signature: `0x${string}`;
}): Promise<VerifyResult> {
  const { address, nonce, issuedAt, signature } = params;

  if (!isValidAddress(address)) return { ok: false, error: "INVALID_ADDRESS" };

  // nonce must exist, be unused, unexpired, and (if pre-bound) match address
  const rec = await db.nonce.findUnique({ where: { nonce } });
  if (!rec || rec.usedAt) return { ok: false, error: "NONCE_INVALID" };
  if (rec.expiresAt.getTime() < Date.now()) return { ok: false, error: "NONCE_EXPIRED" };
  if (rec.address && rec.address !== address.toLowerCase()) return { ok: false, error: "NONCE_MISMATCH" };

  // issuedAt sanity: within +/- 10 minutes
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60 * 1000)
    return { ok: false, error: "BAD_ISSUED_AT" };

  const message = buildAuthMessage({ address, nonce, issuedAt });

  try {
    // PublicClient.verifyMessage: supports EOAs AND smart accounts (AGW)
    // via ERC-6492 / EIP-1271 on-chain isValidSignature — fully trustless.
    const valid = await chainClient.verifyMessage({
      address: address as `0x${string}`,
      message,
      signature,
    });
    if (!valid) return { ok: false, error: "BAD_SIGNATURE" };
  } catch (err) {
    log.warn("signature verification error", { err: String(err) });
    return { ok: false, error: "VERIFICATION_FAILED" };
  }

  // burn nonce (single-use)
  const claimed = await db.nonce.updateMany({
    where: { nonce, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, error: "NONCE_REPLAY" };

  return { ok: true, address: address.toLowerCase() };
}

/** Hash an IP for pseudonymous storage (privacy-preserving audit trail). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}:${serverConfig.SESSION_SECRET.slice(0, 16)}`).digest("hex").slice(0, 32);
}
