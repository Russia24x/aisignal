/**
 * Client-safe logger (no server metadata leaks).
 * Levels controlled by NEXT_PUBLIC_LOG_LEVEL (defaults to warn in prod).
 *
 * @module lib/client-logger
 */
const enabled = process.env.NEXT_PUBLIC_LOG_LEVEL === "debug";

export const createLogger = (scope: string) => ({
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (enabled) console.debug(`[${scope}] ${msg}`, meta ?? "");
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    console.warn(`[${scope}] ${msg}`, meta ?? "");
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    console.error(`[${scope}] ${msg}`, meta ?? "");
  },
});
