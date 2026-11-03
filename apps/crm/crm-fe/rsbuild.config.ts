import { defineConfig } from '@rsbuild/core';

// crm-fe holds only what the browser runs: CSS and small scripts. There is no
// HTML here. crm-be renders every page and reads dist/manifest.json to find
// the hashed asset files. It serves dist/static at /static/.
export default defineConfig({
  // Always production, also in watch mode and when NODE_ENV is "development".
  // A development build has no hashes in the file names.
  mode: 'production',
  source: {
    entry: {
      main: ['./src/main.ts', './src/main.css'],
    },
  },
  output: {
    assetPrefix: '/',
    filenameHash: true,
    manifest: true,
  },
  tools: {
    htmlPlugin: false,
  },
});
