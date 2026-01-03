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
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    define: {
      'import.meta.env.API_URL': JSON.stringify(process.env.API_URL || '/api'),
      'import.meta.env.DEBUG_MODE': JSON.stringify(
        process.env.DEBUG_MODE || 'false',
      ),
    },
  },
});
