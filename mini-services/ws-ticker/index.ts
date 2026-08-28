/**
 * ws-ticker — WebSocket live price ticker mini-service for PenguSignals.
 *
 * Polls DexScreener for the live PENGU/USD pair on Abstract every 15 seconds,
 * caches the snapshot, broadcasts a `price` event to all connected clients,
 * and immediately sends the cached snapshot to new connections.
 *
 * Bound to port 3033 (literal — required by the gateway contract).
 * Path is `/` so Caddy can route via the `XTransformPort` query param.
 *
 * Frontend connects with: io("/?XTransformPort=3033")
 *
 * @module mini-services/ws-ticker/index
 */
import { createServer } from "http";
import { Server } from "socket.io";

const PORT = 3033;
const PENGU_TOKEN = "0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62";
const DEX_URL = `https://api.dexscreener.com/latest/dex/tokens/${PENGU_TOKEN}`;
/** live interval when at least one client is connected (fresh UX) */
const FETCH_ACTIVE_MS = 15_000;
/** idle interval when nobody is connected — keeps cache warm at 1/4 the requests */
const FETCH_IDLE_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

interface PriceSnapshot {
  priceUsd: number;
  change24h: number;
  volume24h: number;
  liquidityUsd: number;
  fdv: number | null;
  fetchedAt: number;
}

let cached: PriceSnapshot | null = null;

/**
 * Fetch the deepest-liquidity PENGU pair on Abstract from DexScreener,
 * reduce it to the slim snapshot shape the UI needs.
 * Returns null on any failure (network / parse / missing fields).
 */
async function fetchSnapshot(): Promise<PriceSnapshot | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(DEX_URL, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": "PenguSignals/1.0 (+https://abs.xyz)",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[ws-ticker] dexscreener HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    const pairs: any[] = data?.pairs ?? [];
    const abstractPairs = pairs.filter((p: any) => p.chainId === "abstract");
    if (abstractPairs.length === 0) {
      console.warn("[ws-ticker] no abstract pairs in response");
      return null;
    }
    // deepest liquidity first — same selection rule as the main market module
    abstractPairs.sort(
      (a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    );
    const p = abstractPairs[0];
    if (!p.priceUsd) {
      console.warn("[ws-ticker] missing priceUsd on best pair");
      return null;
    }
    return {
      priceUsd: Number(p.priceUsd),
      change24h: Number(p.priceChange?.h24 ?? 0),
      volume24h: Number(p.volume?.h24 ?? 0),
      liquidityUsd: Number(p.liquidity?.usd ?? 0),
      fdv: typeof p.fdv === "number" ? p.fdv : null,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn(
      `[ws-ticker] fetch failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tick(): Promise<void> {
  const snap = await fetchSnapshot();
  if (!snap) return;
  cached = snap;
  io.emit("price", snap);
}

const httpServer = createServer((_req, res) => {
  // tiny health-check endpoint so operators can curl the port directly
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      service: "ws-ticker",
      port: PORT,
      clients: io.engine.clientsCount,
      cached,
    }),
  );
});

const io = new Server(httpServer, {
  // DO NOT change the path — Caddy uses it to forward via XTransformPort
  path: "/",
  cors: {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
    credentials: false,
  },
  // permissive during dev: any origin can connect
  allowRequest: (_req, cb) => cb(null, true),
  pingTimeout: 60_000,
  pingInterval: 25_000,
  connectTimeout: 10_000,
});

io.on("connection", (socket) => {
  console.log(
    `[ws-ticker] client connected id=${socket.id} total=${io.engine.clientsCount}`,
  );
  // immediate cached snapshot → UI shows data without waiting for the next tick
  if (cached) socket.emit("price", cached);
  socket.on("disconnect", (reason) => {
    console.log(
      `[ws-ticker] client disconnected id=${socket.id} reason=${reason} total=${io.engine.clientsCount}`,
    );
  });
  socket.on("error", (err) => {
    console.error(`[ws-ticker] socket error id=${socket.id}:`, err);
  });
});

/**
 * Adaptive polling loop (resource-aware):
 *  - clients connected  → poll every 15s (live ticker UX)
 *  - zero clients       → poll every 60s (idle: 75% fewer upstream requests)
 * Cuts idle DexScreener usage from 240 req/hr to 60 req/hr.
 */
let fetchTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFetch(): void {
  const interval = io.engine.clientsCount > 0 ? FETCH_ACTIVE_MS : FETCH_IDLE_MS;
  fetchTimer = setTimeout(async () => {
    await tick();
    scheduleFetch();
  }, interval);
}

const heartbeatTimer = setInterval(() => {
  const iso = new Date().toISOString();
  const priceStr = cached ? cached.priceUsd.toFixed(5) : "—";
  // format: [%s] tick: $%s  clients=%d
  console.log(`[${iso}] tick: $${priceStr}  clients=${io.engine.clientsCount}`);
}, HEARTBEAT_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`[ws-ticker] listening on ${PORT}`);
  // prime the cache immediately so first client gets data on connect
  void tick();
  scheduleFetch();
});

function shutdown(signal: string) {
  console.log(`[ws-ticker] ${signal} received, shutting down...`);
  if (fetchTimer) clearTimeout(fetchTimer);
  clearInterval(heartbeatTimer);
  // Hard-exit after a short grace period: httpServer.close() waits for all
  // connections to drain, which may never happen with lingering sockets —
  // that turns a graceful shutdown into an immortal zombie holding the port.
  const hardExit = setTimeout(() => process.exit(0), 2_000);
  hardExit.unref?.();
  io.close();
  httpServer.close(() => {
    clearTimeout(hardExit);
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
