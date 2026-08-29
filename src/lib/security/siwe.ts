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
 * v4 STATELESS nonces (no database): the nonce is SELF-AUTHENTICATING —
 * `v1.<random>.<issuedAtMs>.<hmac(random|issuedAt|address)>`. Only this
 * server can mint one (HMAC over SESSION_SECRET), the TTL is embedded, and
 * optional address pre-binding is inside the MAC. Single-use enforcement
 * uses a per-isolate in-memory burn set: best-effort replay protection
 * (see SECURITY.md for the honest threat-model discussion — the signed
 * message is also domain-, chain- and time-bound, which keeps the residual
 * replay window both tiny and low-value).
 *
 * Hardening kept from v3:
 *  - the signed message is prepared SERVER-side (the official demo builds it
 *    client-side), so a malicious client cannot tamper with the statement,
 *    domain, URI or chainId it signs;
 *  - domain is validated against BOTH the configured APP_URL host and the
 *    live request host (gateway/proxy-safe);
 *  - message expirationTime is short (10 min) rather than the demo's 7 days.
 *
 * @module lib/security/siwe
 */
import { createHmac, randomBytes } from "node:crypto";
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
import { serverConfig, publicConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:siwe");

/** How long a prepared sign-in message stays valid. */
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

/* ------------------------------------------------------------------ */
/* Stateless, self-authenticating nonces                               */
/* ------------------------------------------------------------------ */

function mac(data: string): string {
  return createHmac("sha256", serverConfig.SESSION_SECRET).update(data).digest("base64url");
}

/**
 * Mint a nonce: `v1 + <random48hex> + <issuedAtHex> + <hmac64hex>`.
 * Fully ALPHANUMERIC — the EIP-4361 ABNF requires `nonce = 8*ALPHANUM`,
 * so no separators or base64url characters are allowed. The MAC covers
 * random|issuedAt|address, proving server issuance, embedded TTL and
 * address pre-binding with zero storage.
 */
export function issueNonce(address?: string): { nonce: string } {
  const random = randomBytes(24).toString("hex"); // 48 chars
  const issuedAt = Date.now();
  const bind = address?.toLowerCase() ?? "";
  const sig = Buffer.from(mac(`${random}.${issuedAt}.${bind}`), "base64url").toString("hex"); // 64 chars
  return { nonce: `v1${random}${issuedAt.toString(16)}${sig}` };
}

interface NonceTicket {
  issuedAt: number;
}

const HEX_RE = /^[0-9a-f]+$/;

/**
 * Parse & verify a self-authenticating nonce against the claiming address.
 * Returns null when the MAC is wrong (not minted by us / wrong binding),
 * the TTL has passed, or the clock skews.
 */
function verifyNonceTicket(nonce: string, claimAddress: string): NonceTicket | null {
  if (!nonce.startsWith("v1") || nonce.length <= 2 + 48 + 64) return null;
  const body = nonce.slice(2);
  const random = body.slice(0, 48);
  const sig = body.slice(-64);
  const tsHex = body.slice(48, -64);
  if (!HEX_RE.test(random) || !HEX_RE.test(sig) || !HEX_RE.test(tsHex)) return null;
  const issuedAt = parseInt(tsHex, 16);
  if (!Number.isFinite(issuedAt)) return null;
  // binding: the MAC input used the address the nonce was minted for — a
  // nonce pre-bound to wallet A cannot be replayed inside a message from wallet B
  const sigBuf = Buffer.from(sig, "hex").toString("base64url");
  const expected = mac(`${random}.${issuedAt}.${claimAddress.toLowerCase()}`);
  const expectedUnbound = mac(`${random}.${issuedAt}.`);
  if (sigBuf !== expected && sigBuf !== expectedUnbound) return null;
  if (Date.now() - issuedAt > MESSAGE_TTL_MS) return null; // expired
  if (Date.now() < issuedAt - 5 * 60 * 1000) return null; // clock skew
  return { issuedAt };
}

/* ------------------------------------------------------------------ */
/* Burn set (best-effort single-use, per isolate)                      */
/* ------------------------------------------------------------------ */

const spentNonces = new Map<string, number>();

function burnNonce(nonce: string): boolean {
  const now = Date.now();
  // prune expired entries occasionally
  if (spentNonces.size > 5000) {
    for (const [k, t] of spentNonces) {
      if (now - t > MESSAGE_TTL_MS * 2) spentNonces.delete(k);
    }
  }
  if (spentNonces.has(nonce)) return false; // replay
  spentNonces.set(nonce, now);
  return true;
}

/* ------------------------------------------------------------------ */
/* Message construction & verification                                 */
/* ------------------------------------------------------------------ */

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
 * EIP-1271) plus our stateless nonce hardening.
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

  // 5. Nonce — self-authenticating (HMAC proves WE minted it; TTL and
  //    address binding are embedded in the MAC)
  const ticket = verifyNonceTicket(siwe.nonce, address);
  if (!ticket) return { ok: false, error: "NONCE_INVALID" };

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

  // 7. Burn the nonce (single-use — best-effort per isolate, see header)
  if (!burnNonce(siwe.nonce)) return { ok: false, error: "NONCE_REPLAY" };

  return { ok: true, address: address.toLowerCase() };
}
