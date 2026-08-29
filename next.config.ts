import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` — production runs on Cloudflare Workers via
  // @opennextjs/cloudflare (see wrangler.jsonc + docs/DEPLOYMENT.md), which
  // performs its own build. Local dev is unaffected (`next dev`).
  //
  // Images: served as-is (both public PNGs are ~80KB, already optimized).
  // This keeps the Cloudflare deploy 100% free — no image optimization
  // service, no sharp native binary shipped to the worker.
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Dev only: allow HMR/_next resource requests from the sandbox preview
  // proxy (preview-chat-*.space-z.ai). Without this, Next 15 dev warns on
  // every cross-origin _next fetch and may block Fast Refresh assets.
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
