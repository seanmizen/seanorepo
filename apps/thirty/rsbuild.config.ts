import { execSync } from 'node:child_process';
import { defineConfig } from '@rsbuild/core';

// Where: apps/thirty. Port 4110, localhost only.
// Why: no HMR and no live reload, so an open page stays on the build it loaded.
export default defineConfig({
  html: { title: 'thirty' },
  server: { port: 4110, host: 'localhost', strictPort: true },
  dev: { hmr: false, liveReload: false },
  source: {
    define: {
      GIT_SHA: JSON.stringify(
        execSync('git rev-parse --short HEAD').toString().trim(),
      ),
    },
  },
});
