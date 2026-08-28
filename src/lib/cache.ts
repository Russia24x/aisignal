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
    const fresh = await loader();
    this.set(key, fresh);
    return fresh;
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
