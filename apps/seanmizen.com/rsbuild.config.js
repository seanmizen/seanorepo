import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginGlsl } from 'rsbuild-plugin-glsl';

export default defineConfig({
  plugins: [pluginReact(), pluginGlsl()],
  source: {
    entry: { index: './src/index.tsx' },
  },
  html: {
    template: './public/index.html',
  },
  /* In dev, /api goes to the cron service (apps/cron, `yarn cron`). In prod,
     the tunnel sends seanmizen.com/api/* there. */
  server: {
    proxy: { '/api': process.env.CRON_API || 'http://localhost:4001' },
  },
  output: {
    /* Absolute, so a nested route such as /projects/shaders loads its
       scripts from /static and not from /projects/static. */
    assetPrefix: '/',
  },
});
