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
      // swap.ts updates a part of the page in place (`data-swap`).
      main: ['./src/main.ts', './src/swap.ts', './src/theme.css'],
      // Only the pages with a passkey control load this entry: /login,
      // /account/passkeys and the 403 page of an admin route.
      passkeys: './src/passkeys.ts',
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
