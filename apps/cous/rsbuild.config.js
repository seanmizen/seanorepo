import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: './src/index.tsx' },
  },
  html: {
    template: './public/index.html',
  },
  server: {
    port: 4070,
    // The dev server sends /api to the backend (cous-be). In production,
    // cloudflared and the edge do this. With no backend, the leaderboard
    // shows that it is offline. Docker dev sets API_PROXY_TARGET.
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:4071',
    },
  },
});
