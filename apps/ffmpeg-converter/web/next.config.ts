import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Build the app as a standalone server (smaller prod docker images,
  // self-contained `node server.js`).
  output: 'standalone',
  // NOTE: We don't use Next's `rewrites()` for the API proxy. The catch-all
  // route at src/app/api/[...slug]/route.ts handles same-origin proxying
  // AND falls back to an in-memory mock when the Go backend is offline,
  // mirroring the legacy web-spa/dev.ts behaviour.
};

export default nextConfig;
