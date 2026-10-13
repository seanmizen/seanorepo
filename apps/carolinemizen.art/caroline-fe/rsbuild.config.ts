import path from 'node:path';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const API_URL = process.env.API_URL || '/api';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './public/index.html',
    templateParameters: { apiUrl: API_URL },
  },
  output: {
    assetPrefix: '/',
  },
  source: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    define: {
      'import.meta.env.API_URL': JSON.stringify(API_URL),
      'import.meta.env.DEBUG_MODE': JSON.stringify(
        process.env.DEBUG_MODE || 'false',
      ),
    },
  },
});
