// Where: apps/ordnance/rsbuild.config.js
// When: `yarn workspace ordnance start` (the dev server on 4110) and
// `yarn workspace ordnance build` (dist/).
// Why: bundles src/boot.ts with the swindowzig wasm loader. The page
// template is public/index.html. build.sh puts ordnance.wasm in public/,
// and the dev server serves public/ as static files.
import path from 'node:path';
import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: {
    entry: { index: './src/boot.ts' },
  },
  resolve: {
    alias: {
      '#swindowzig': path.resolve(
        import.meta.dirname,
        'game/zig-out/swindowzig-wasm',
      ),
    },
  },
  html: {
    template: './public/index.html',
  },
  server: {
    port: 4110,
    host: '127.0.0.1',
  },
});
