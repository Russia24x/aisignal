/**
 * Central application configuration — single source of truth.
 *
 * Design principles:
 *  - Nothing is hardcoded in feature code; everything flows from env vars.
 *  - Values are parsed & validated once at module load; invalid config fails fast.
 *  - Public values are exposed through `publicConfig` for client components.
 *
 * @module lib/config
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Parse a `key:minutes:seconds`-free simple rate limit string `limit/windowMs`. */
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
  DATABASE_URL: z.string().min(1),

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
  HISTORY_CACHE_TTL_MS: z.coerce.number().default(900_000),
  DATA_FETCH_TIMEOUT_MS: z.coerce.number().default(15_000),

  // Rate limits
  RATE_LIMIT_AUTH: z.string().default("10/60000"),
  RATE_LIMIT_PAYMENT: z.string().default("10/60000"),
  RATE_LIMIT_SIGNAL: z.string().default("30/60000"),
  RATE_LIMIT_PUBLIC: z.string().default("60/60000"),

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
  },
} as const;
