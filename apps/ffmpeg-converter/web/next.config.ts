import type { NextConfig } from 'next';
import { MATRIX } from './src/ops/matrix';
import { generateRedirects } from './src/ops/redirects';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Build the app as a standalone server (smaller prod docker images,
  // self-contained `node server.js`).
  output: 'standalone',
  // NOTE: We don't use Next's `rewrites()` for the API proxy. The catch-all
  // route at src/app/api/[...slug]/route.ts handles same-origin proxying
  // AND falls back to an in-memory mock when the Go backend is offline,
  // mirroring the legacy web-spa/dev.ts behaviour.

  /**
   * SEAN-59 — 301 redirects from common slug misspellings to canonical pages.
   *
   * Generated programmatically from the operations matrix; adding a new
   * canonical from-to row automatically produces the four misspelling
   * redirects (`mp4tomov`, `mp4-mov`, `mp4_mov`, `convert-mp4-mov`) for it.
   *
   * Runs at the edge — no per-request JS. See `src/ops/redirects.ts`.
   */
  async redirects() {
    return generateRedirects(MATRIX);
  },
};

export default nextConfig;
