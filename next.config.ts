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
};

export default nextConfig;
