import path from 'node:path';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './public/index.html',
  },
  output: {
    assetPrefix: '/',
  },
  source: {
    // Single API-base strategy: baked in at build time. Docker passes API_URL
    // as a build arg. In production behind cloudflared it stays '/api' and the
    // tunnel routes it to the backend.
    define: {
      'import.meta.env.API_URL': JSON.stringify(process.env.API_URL || '/api'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared'),
    },
  },
});
