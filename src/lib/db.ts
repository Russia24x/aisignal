/**
 * Prisma client factory — one export, two runtimes:
 *
 *  - Local dev (Node/Bun): classic client over the SQLite file via
 *    DATABASE_URL from .env — exactly as before.
 *  - Cloudflare Workers (production): the `DB` D1 binding injected by
 *    OpenNext (`@opennextjs/cloudflare`) is wrapped in the official
 *    `@prisma/adapter-d1` driver adapter. No filesystem, no Rust engine.
 *
 * The D1 binding is detected structurally (`prepare` function) so a plain
 * string env var named DB can never be mistaken for a database.
 *
 * @module lib/db
 */
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

/* Minimal structural type for a Cloudflare D1 database handle. */
interface D1Like {
  prepare: (query: string) => unknown;
}

function getD1Binding(): D1Like | null {
  // OpenNext for Cloudflare exposes worker bindings on `process.env`.
  const candidates: unknown[] = [
    (process.env as Record<string, unknown> | undefined)?.DB,
    (globalThis as Record<string, unknown>).DB,
  ];
  for (const c of candidates) {
    if (c && typeof (c as D1Like).prepare === "function") return c as D1Like;
  }
  return null;
}

function createPrismaClient(): PrismaClient {
  const d1 = getD1Binding();
  if (d1) {
    // Cloudflare Workers → D1 (free tier, no credit card required).
    // Cast: the structural `prepare` check above already guarantees this is
    // a real D1 handle; the adapter's nominal type comes from
    // @cloudflare/workers-types which we avoid importing directly.
    return new PrismaClient({ adapter: new PrismaD1(d1 as never) });
  }
  // Local dev / Node → SQLite file via DATABASE_URL
  return new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["query"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
