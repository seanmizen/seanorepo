// Where: apps/tcp-getter. `yarn build` reads this file.
// When:  every deploy. services/deploy.sh builds this workspace before it
//        restarts custom-tcp-getter.service.
// Why:   Node 20 cannot run TypeScript. The host has Node and yarn and no bun,
//        and rslib is the bundler this monorepo already uses for a backend
//        (apps/carolinemizen.art/caroline-be). CLAUDE.md gives bundling to the
//        build tool, not to bun.
import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2022',
      // Nothing imports this workspace, so declarations would be dead output.
      dts: false,
    },
  ],
  source: {
    // rslib looks for src/index.ts by default. This workspace keeps its entry
    // at the root. Naming it here is smaller than moving the file, which this
    // ticket has no reason to do.
    entry: { index: './index.ts' },
  },
  output: {
    target: 'node',
    // The unit runs `node --env-file=.env dist/index.js`. Keep that name.
    distPath: { root: './dist' },
  },
});
