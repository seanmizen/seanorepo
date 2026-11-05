// Where: apps/ordnance/rsbuild.config.js
// When: `yarn workspace ordnance start` (the dev server on 4110),
// `yarn workspace ordnance styles` (one dev server for each playstyle,
// 4111 to 4116) and `yarn workspace ordnance build` (dist/).
// ORDNANCE_STYLE picks the default style of the page, PORT the port.
// Why: bundles src/boot.ts with the swindowzig wasm loader. The page
// template is public/index.html. build.sh puts ordnance.wasm in public/,
// and the dev server serves public/ as static files.
import path from 'node:path';
import { defineConfig } from '@rsbuild/core';

export default defineConfig({
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
  source: {
    entry: { index: './src/boot.ts' },
    define: {
      'process.env.ORDNANCE_STYLE': JSON.stringify(
        process.env.ORDNANCE_STYLE ?? '',
      ),
    },
  },
  server: {
    port: Number(process.env.PORT ?? 4110),
    host: '127.0.0.1',
  },
});
