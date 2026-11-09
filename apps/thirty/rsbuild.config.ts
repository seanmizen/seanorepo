import { execSync } from 'node:child_process';
import { defineConfig } from '@rsbuild/core';

// Where: apps/thirty. Port 4110, localhost only.
// Why: no HMR and no live reload, so an open page stays on the build it loaded.
// bench.html is the GPU and CPU stress bench (src/bench.ts).
export default defineConfig({
  html: {
    title: 'thirty',
    // No icon file. A static server answers /favicon.ico with a 404, and
    // scripts/check-urls.mjs fails on that console error.
    tags: [{ tag: 'link', attrs: { rel: 'icon', href: 'data:,' } }],
  },
  server: { port: 4110, host: 'localhost', strictPort: true },
  dev: { hmr: false, liveReload: false },
  source: {
    entry: { index: './src/index.ts', bench: './src/bench.ts' },
    define: {
      // The docker image has no .git, so the dockerfile sets GIT_SHA.
      GIT_SHA: JSON.stringify(
        process.env.GIT_SHA ||
          execSync('git rev-parse --short HEAD').toString().trim(),
      ),
    },
  },
});
