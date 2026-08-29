/**
 * GET /api/payment/config — public payment configuration (target plan §7).
 *
 * Everything the client needs to construct a payment in ANY enabled token:
 *   - chain + treasury + token registry
 *   - per-product prices in PENGU (the denomination)
 *   - per-product live quotes in non-PENGU tokens, HMAC-SIGNED so the
 *     verify endpoint can trust the rate without any storage (30 min TTL)
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { publicConfig } from "@/lib/config";
import { productCatalog } from "@/lib/modules/access/entitlements";
import { buildQuote } from "@/lib/modules/access/payments";
import { PAY_TOKENS, type PayTokenDef } from "@/lib/modules/access/tokens";
import { fetchEthPrice } from "@/lib/modules/market/binance";
import { getSnapshot } from "@/lib/modules/market/service";
import { createLogger } from "@/lib/logger";

const log = createLogger("payment:config");

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  const products = productCatalog();
  const tokens = PAY_TOKENS.filter((t) => t.enabled);

  // live cross-rates for non-PENGU quotes (best-effort: if the market data
  // is unavailable we still return PENGU pricing — the client falls back to
  // the PENGU flow)
  let penguUsd: number | null = null;
  let ethUsd: number | null = null;
  try {
    const snap = await getSnapshot();
    penguUsd = snap.priceUsd;
  } catch (err) {
    log.warn("pengu price unavailable for quotes", { err: String(err) });
  }
  if (penguUsd && penguUsd > 0) {
    try {
      ethUsd = await fetchEthPrice();
    } catch (err) {
      log.warn("eth price unavailable for quotes", { err: String(err) });
    }
  }

  /** quotes[product][tokenKey] = { amountToken, quote } */
  const quotes: Record<
    string,
    Record<string, { amountToken: number; quote: ReturnType<typeof buildQuote> }>
  > = {};
  if (penguUsd && penguUsd > 0) {
    for (const [id, prod] of Object.entries(products)) {
      quotes[id] = {};
      const usdPrice = prod.pricePengu * penguUsd;
      for (const t of tokens) {
        if (t.key === "PENGU") continue;
        let amountToken: number | null = null;
        if (t.key === "ETH" && ethUsd && ethUsd > 0) {
          // round UP to 6 decimals so the required amount is never under-paid
          amountToken = Math.ceil((usdPrice / ethUsd) * 1e6) / 1e6;
        }
        // (future stablecoins: amountToken = usdPrice / stableUsd)
        if (amountToken !== null) {
          quotes[id][t.key] = {
            amountToken,
            quote: buildQuote(id, t.key, amountToken, t.decimals),
          };
        }
      }
    }
  }

  const tokenDtos: Array<Pick<PayTokenDef, "key" | "kind" | "address" | "decimals" | "symbol">> =
    tokens.map((t) => ({
      key: t.key,
      kind: t.kind,
      address: t.address,
      decimals: t.decimals,
      symbol: t.symbol,
    }));

  return NextResponse.json({
    ok: true,
    chain: {
      id: publicConfig.chainId,
      rpcUrl: publicConfig.rpcUrl,
      explorerUrl: publicConfig.explorerUrl,
    },
    token: {
      // primary (PENGU ERC-20) kept at the top level for backwards compat
      symbol: "PENGU",
      address: publicConfig.penguToken,
      decimals: 18,
    },
    tokens: tokenDtos,
    treasury: publicConfig.treasury,
    products,
    quotes,
  });
}
