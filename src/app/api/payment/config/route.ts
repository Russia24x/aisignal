/**
 * GET /api/payment/config — public payment configuration.
 * Everything the client needs to construct the ERC-20 transfer.
 */
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/security/rate-limit";
import { publicConfig } from "@/lib/config";
import { productCatalog } from "@/lib/modules/access/entitlements";

export async function GET(req: NextRequest) {
  const limited = guard(req, "public");
  if (limited) return limited;

  return NextResponse.json({
    ok: true,
    chain: {
      id: publicConfig.chainId,
      rpcUrl: publicConfig.rpcUrl,
      explorerUrl: publicConfig.explorerUrl,
    },
    token: {
      symbol: "PENGU",
      address: publicConfig.penguToken,
      decimals: 18,
    },
    treasury: publicConfig.treasury,
    products: productCatalog(),
  });
}
