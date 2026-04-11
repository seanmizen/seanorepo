import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './public/index.html',
  },
  source: {
    define: {
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'development'),
      'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.API_BASE ?? 'http://localhost:4041'),
    },
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
  server: {
    port: 4040,
    proxy: {
      '/api': 'http://localhost:4041',
    },
  },
});
