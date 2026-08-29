/**
 * Tiny in-memory TTL cache with stale-while-revalidate semantics.
 *
 * Rationale: the deployment target (Cloudflare free tier) allows in-memory
 * caching per isolate; a Redis dependency is deliberately avoided (free,
 * no-credit-card constraint). TTLs are short and data is public market data.
 *
 * @module lib/cache
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
  /** soft expiry — serve stale & refresh in background */
  softExpiresAt: number;
  refreshing?: Promise<T> | null;
}

export class TTLCache<T> {
  private store = new Map<string, Entry<T>>();
  constructor(
    private readonly ttlMs: number,
    private readonly softTtlMs: number = Math.floor(ttlMs / 2),
    private readonly maxEntries = 128,
  ) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  /** Get value; if soft-expired, kick off background refresh via loader. */
  async getOrRefresh(key: string, loader: () => Promise<T>): Promise<T> {
    const e = this.store.get(key);
    const now = Date.now();
    if (e && now <= e.expiresAt) {
      if (now > e.softExpiresAt && !e.refreshing) {
        // stale-while-revalidate: return stale value, refresh in background
        e.refreshing = loader()
          .then((v) => {
            this.set(key, v);
            return v;
          })
          .catch(() => e.value)
          .finally(() => {
            if (this.store.get(key) === e) e.refreshing = null;
          });
      }
      return e.value;
    }
    // COLD PATH — dedupe concurrent loads (cache stampede guard): the first
    // caller starts the loader; everyone else awaiting the same key shares
    // that in-flight promise instead of hammering the upstream API.
    const existing = this.store.get(key);
    if (existing?.refreshing) return existing.refreshing;
    const pending = loader()
      .then((v) => {
        this.set(key, v);
        return v;
      })
      .catch((err) => {
        // failed load: drop the placeholder so the NEXT caller retries
        // instead of sharing a rejected promise forever
        const cur = this.store.get(key);
        if (cur && cur.expiresAt === 0) this.store.delete(key);
        else if (cur === existing && existing) existing.refreshing = null;
        throw err;
      })
      .finally(() => {
        if (this.store.get(key) === existing && existing) existing.refreshing = null;
      });
    if (existing) {
      existing.refreshing = pending;
    } else {
      // track the in-flight promise on a placeholder entry so concurrent
      // cold callers find it (expiresAt=0 → never served as a value)
      this.store.set(key, {
        value: undefined as T,
        softExpiresAt: 0,
        expiresAt: 0,
        refreshing: pending,
      });
    }
    return pending;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      // simple eviction: drop oldest entries first
      const drop = this.store.keys().next().value;
      if (drop) this.store.delete(drop);
    }
    this.store.set(key, {
      value,
      softExpiresAt: Date.now() + this.softTtlMs,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
