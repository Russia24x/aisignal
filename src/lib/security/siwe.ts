/**
 * Official SIWE (Sign-In With Ethereum, EIP-4361) authentication for
 * Abstract wallets — built on the standard `viem/siwe` utilities exactly as
 * prescribed by the official Abstract docs:
 *   - https://build.abs.xyz/docs/authentication/siwe-button
 *   - https://docs.abs.xyz/abstract-global-wallet/agw-react/native-integration
 *
 * Flow (server-prepared message — tamper-proof by construction):
 *  1. Client requests a nonce:   GET  /api/auth/nonce?address=0x..
 *     → server generates an official `generateSiweNonce()` and builds the
 *       EIP-4361 message with `createSiweMessage()` (domain, URI, chainId,
 *       nonce, issuedAt, expirationTime all server-controlled).
 *  2. Client signs the message with the wallet (AGW or EOA) — click-triggered.
 *  3. Client posts {message, signature}:  POST /api/auth/verify
 *  4. Server parses the message with `parseSiweMessage()`, validates
 *     structure + chain + domain + expiry + single-use nonce, then verifies
 *     the signature via `publicClient.verifySiweMessage()` — which
 *     transparently supports EIP-1271 contract signatures (Abstract Global
 *     Wallet is a smart account) — burns the nonce and creates a session.
 *
 * Hardening on top of the official reference implementation:
 *  - nonces are persisted in the DB (single-use + TTL + optional address
 *    pre-binding) instead of a session cookie → survives isolates, works
 *    with D1 on Cloudflare Workers;
 *  - the signed message is prepared SERVER-side (the official demo builds it
 *    client-side), so a malicious client cannot tamper with the statement,
 *    domain, URI or chainId it signs;
 *  - domain is validated against BOTH the configured APP_URL host and the
 *    live request host (gateway/proxy-safe);
 *  - message expirationTime is short (10 min) rather than the demo's 7 days.
 *
 * @module lib/security/siwe
 */
import { createHash } from "node:crypto";
import {
  createPublicClient,
  http,
  checksumAddress,
  isAddress,
} from "viem";
import {
  createSiweMessage,
  generateSiweNonce,
  parseSiweMessage,
  validateSiweMessage,
} from "viem/siwe";
import type { PublicClient } from "viem";
import { db } from "@/lib/db";
import { serverConfig, publicConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:siwe");

/** How long a prepared sign-in message stays valid (official demo: 7 days —
 *  we tighten to 10 minutes; the SESSION itself has its own 7-day TTL). */
const MESSAGE_TTL_MS = 10 * 60 * 1000;
/** Sanity ceiling for a message expirationTime (guards far-future clocks). */
const MAX_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

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

/** Allowed hosts for the EIP-4361 `domain` field (app URL + request host). */
function allowedDomains(extraHost?: string | null): Set<string> {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(publicConfig.appUrl).host.toLowerCase());
  } catch {
    /* APP_URL already validated by config schema */
  }
  if (extraHost) hosts.add(extraHost.toLowerCase());
  // localhost variants are interchangeable for local dev
  if (hosts.has("localhost:3000")) hosts.add("127.0.0.1:3000");
  if (hosts.has("127.0.0.1:3000")) hosts.add("localhost:3000");
  return hosts;
}

/** Issue a single-use, official-format nonce (optionally address-bound). */
export async function issueNonce(address?: string): Promise<{ nonce: string }> {
  // housekeeping: drop expired nonces occasionally
  await db.nonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const nonce = generateSiweNonce(); // official viem/siwe generator
  await db.nonce.create({
    data: {
      nonce,
      address: address?.toLowerCase() ?? null,
      expiresAt: new Date(Date.now() + MESSAGE_TTL_MS),
    },
  });
  return { nonce };
}

/**
 * Build the exact EIP-4361 message the user must sign, using the official
 * `createSiweMessage()` helper (server-controlled → tamper-proof).
 */
export function buildAuthMessage(params: {
  address: string;
  nonce: string;
  issuedAt?: Date;
  statement?: string;
}): string {
  const issuedAt = params.issuedAt ?? new Date();
  return createSiweMessage({
    domain: new URL(publicConfig.appUrl).host,
    address: toChecksum(params.address) as `0x${string}`,
    statement:
      params.statement ??
      "Sign in to PenguSignals. This signature proves wallet ownership — no transactions, no fees.",
    uri: new URL(publicConfig.appUrl).origin,
    version: "1",
    chainId: publicConfig.chainId,
    nonce: params.nonce,
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + MESSAGE_TTL_MS),
  });
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
  address?: string;
}

/**
 * Verify a signed SIWE payload — the official verification chain
 * (parse → validate structure → validate fields → verifySiweMessage with
 * EIP-1271) plus our DB nonce hardening.
 *
 * @param params.message    the exact EIP-4361 string the wallet signed
 * @param params.signature  0x-prefixed hex signature
 * @param params.requestHost  Host header of the verify request (domain check)
 */
export async function verifyAuth(params: {
  message: string;
  signature: `0x${string}`;
  requestHost?: string | null;
}): Promise<VerifyResult> {
  const { message, signature, requestHost } = params;

  // 1. Parse + structural validation (official helpers)
  let siwe: ReturnType<typeof parseSiweMessage>;
  try {
    siwe = parseSiweMessage(message);
  } catch {
    return { ok: false, error: "INVALID_MESSAGE" };
  }
  if (!siwe?.address || !siwe.nonce) return { ok: false, error: "INVALID_MESSAGE" };
  if (!validateSiweMessage({ message: siwe })) return { ok: false, error: "INVALID_MESSAGE" };

  const address = siwe.address as string;
  if (!isValidAddress(address)) return { ok: false, error: "INVALID_ADDRESS" };

  // 2. Chain binding — the signed chainId must be our configured Abstract chain
  if (siwe.chainId !== publicConfig.chainId) return { ok: false, error: "INVALID_CHAIN" };

  // 3. Domain binding — anti cross-domain replay (official check, gateway-aware)
  const domains = allowedDomains(requestHost);
  if (!siwe.domain || !domains.has(siwe.domain.toLowerCase())) {
    return { ok: false, error: "INVALID_DOMAIN" };
  }

  // 4. Expiration — message must not be expired (nor absurdly long-lived)
  const now = Date.now();
  if (siwe.expirationTime) {
    const exp = siwe.expirationTime.getTime();
    if (exp <= now) return { ok: false, error: "MESSAGE_EXPIRED" };
    if (exp - now > MAX_MESSAGE_TTL_MS) return { ok: false, error: "MESSAGE_EXPIRED" };
  }
  if (siwe.issuedAt && siwe.issuedAt.getTime() - now > 5 * 60 * 1000) {
    return { ok: false, error: "BAD_ISSUED_AT" }; // clock skew > 5 min ahead
  }

  // 5. Nonce — single-use, unexpired, address-bound (our DB hardening)
  const rec = await db.nonce.findUnique({ where: { nonce: siwe.nonce } });
  if (!rec || rec.usedAt) return { ok: false, error: "NONCE_INVALID" };
  if (rec.expiresAt.getTime() < now) return { ok: false, error: "NONCE_EXPIRED" };
  if (rec.address && rec.address !== address.toLowerCase()) {
    return { ok: false, error: "NONCE_MISMATCH" };
  }

  // 6. Signature — official verifySiweMessage (EOA + EIP-1271 smart wallets
  //    like AGW via on-chain isValidSignature, ERC-6492-aware)
  try {
    const valid = await chainClient.verifySiweMessage({
      message,
      signature,
      blockTag: "latest",
    });
    if (!valid) return { ok: false, error: "BAD_SIGNATURE" };
  } catch (err) {
    log.warn("signature verification error", { err: String(err) });
    return { ok: false, error: "VERIFICATION_FAILED" };
  }

  // 7. Burn the nonce (single-use — atomic claim guards concurrent replays)
  const claimed = await db.nonce.updateMany({
    where: { nonce: siwe.nonce, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, error: "NONCE_REPLAY" };

  return { ok: true, address: address.toLowerCase() };
}

/** Hash an IP for pseudonymous storage (privacy-preserving audit trail). */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}:${serverConfig.SESSION_SECRET.slice(0, 16)}`).digest("hex").slice(0, 32);
}
