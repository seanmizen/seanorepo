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
    // One API-base strategy: rsbuild bakes it in at build time. Local dev and
    // Docker dev set API_URL to the backend on port 4101.
    define: {
      'import.meta.env.API_URL': JSON.stringify(
        process.env.API_URL || 'http://localhost:4101/api',
      ),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared'),
    },
  },
});
