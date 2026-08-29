/**
 * Central application configuration — single source of truth.
 *
 * Design principles:
 *  - Nothing is hardcoded in feature code; everything flows from env vars.
 *  - Values are parsed & validated once at module load; invalid config fails fast.
 *  - Public values are exposed through `publicConfig` for client components.
 *
 * v4 (stateless architecture): DATABASE_URL is GONE. The application keeps
 * NO persistent storage — market data is fetched live and cached in memory,
 * entitlements live inside the HMAC-signed session, payments are verified
 * on-chain, and history is deterministically recomputed from public candles.
 *
 * @module lib/config
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Parse a simple rate limit string `limit/windowMs`. */
function parseRate(raw: string): { limit: number; windowMs: number } {
  const [limit, windowMs] = raw.split("/");
  return { limit: Number(limit), windowMs: Number(windowMs) };
}

const ethereumAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

/* ------------------------------------------------------------------ */
/* Server schema                                                       */
/* ------------------------------------------------------------------ */

const serverSchema = z.object({
  APP_NAME: z.string().min(1).default("PenguSignals"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be >= 32 chars"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Chain (server-side verification uses these)
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive(),
  NEXT_PUBLIC_RPC_URL: z.string().url(),
  NEXT_PUBLIC_EXPLORER_URL: z.string().url(),

  // Tokens & payments (tariff itself lives in lib/modules/access/passes.ts —
  // the single source of truth shared by client and server)
  NEXT_PUBLIC_PENGU_TOKEN: ethereumAddress,
  NEXT_PUBLIC_TREASURY: ethereumAddress,

  // Data services
  MARKET_CACHE_TTL_MS: z.coerce.number().default(60_000),
  /** TTL of the long daily-candle series used for history recomputation. */
  HISTORY_CACHE_TTL_MS: z.coerce.number().default(900_000),
  DATA_FETCH_TIMEOUT_MS: z.coerce.number().default(15_000),

  // Per-timeframe signal caches (target plan §13):
  //   15m → 30s, 1h → 60s, 4h/1d → 120s. All users inside a cache window
  //   see the SAME signal (fairness without a database).
  SIGNAL_TF_TTL_15M_MS: z.coerce.number().default(30_000),
  SIGNAL_TF_TTL_1H_MS: z.coerce.number().default(60_000),
  SIGNAL_TF_TTL_4H_MS: z.coerce.number().default(120_000),
  SIGNAL_TF_TTL_1D_MS: z.coerce.number().default(120_000),

  // Payment quotes (non-PENGU tokens): how long an HMAC-signed quote stays
  // acceptable, and how much slippage vs. the quote we tolerate at verify.
  PAYMENT_QUOTE_TTL_MS: z.coerce.number().default(1_800_000),
  PAYMENT_SLIPPAGE_PCT: z.coerce.number().default(3),

  // On-chain entitlement recovery (eth_getLogs treasury scan)
  RESTORE_SCAN_LOOKBACK_DAYS: z.coerce.number().default(400),
  RESTORE_SCAN_CHUNK_BLOCKS: z.coerce.number().default(4_000_000),
  RESTORE_CACHE_TTL_MS: z.coerce.number().default(600_000),

  // Rate limits.
  // AUTH is generous on purpose: one sign-in = nonce + verify (2 hits), the
  // auto sign-in fires on every wallet connect, and behind a single gateway
  // ALL visitors share one client IP — 10/min made normal usage hit 429s.
  // PUBLIC must absorb session polls from every useAuth() instance plus
  // market/profile fetches on each page load (~10 req/load).
  // RESTORE is RPC-expensive (chunked eth_getLogs) → tight window.
  RATE_LIMIT_AUTH: z.string().default("30/60000"),
  RATE_LIMIT_PAYMENT: z.string().default("10/60000"),
  RATE_LIMIT_SIGNAL: z.string().default("30/60000"),
  RATE_LIMIT_PUBLIC: z.string().default("120/60000"),
  RATE_LIMIT_RESTORE: z.string().default("6/300000"),

  // Session
  SESSION_TTL_HOURS: z.coerce.number().default(168),

  // i18n
  NEXT_PUBLIC_DEFAULT_LOCALE: z.string().default("fa"),
  NEXT_PUBLIC_SUPPORTED_LOCALES: z.string().default("fa,en"),
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const parsed = serverSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

/* ------------------------------------------------------------------ */
/* Public config                                                       */
/* ------------------------------------------------------------------ */

export const publicConfig = {
  appName: env.APP_NAME,
  appUrl: env.APP_URL,
  chainId: env.NEXT_PUBLIC_CHAIN_ID,
  rpcUrl: env.NEXT_PUBLIC_RPC_URL,
  explorerUrl: env.NEXT_PUBLIC_EXPLORER_URL,
  penguToken: env.NEXT_PUBLIC_PENGU_TOKEN.toLowerCase() as `0x${string}`,
  treasury: env.NEXT_PUBLIC_TREASURY.toLowerCase() as `0x${string}`,
  defaultLocale: env.NEXT_PUBLIC_DEFAULT_LOCALE,
  supportedLocales: env.NEXT_PUBLIC_SUPPORTED_LOCALES.split(","),
} as const;

/* ------------------------------------------------------------------ */
/* Server config (server-only)                                         */
/* ------------------------------------------------------------------ */

export const serverConfig = {
  ...env,
  rateLimits: {
    auth: parseRate(env.RATE_LIMIT_AUTH),
    payment: parseRate(env.RATE_LIMIT_PAYMENT),
    signal: parseRate(env.RATE_LIMIT_SIGNAL),
    public: parseRate(env.RATE_LIMIT_PUBLIC),
    restore: parseRate(env.RATE_LIMIT_RESTORE),
  },
  /** Per-timeframe cache TTLs keyed by timeframe id. */
  timeframeTtlMs: {
    "15m": env.SIGNAL_TF_TTL_15M_MS,
    "1h": env.SIGNAL_TF_TTL_1H_MS,
    "4h": env.SIGNAL_TF_TTL_4H_MS,
    "1d": env.SIGNAL_TF_TTL_1D_MS,
  } as Record<"15m" | "1h" | "4h" | "1d", number>,
} as const;
