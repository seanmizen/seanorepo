// The page bundle of action.seanmizen.com: src/boot.ts (with the
// swindowzig wasm loader and tube-sounds) -> $BUNDLE_OUT_DIR/boot.js.
// build.sh and the dockerfile run `yarn rsbuild build`. The bundle is one
// minified ES module file with a fixed name, and no HTML. public/index.html
// loads it with <script type="module">.

import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: { entry: { boot: './src/boot.ts' } },
  output: {
    target: 'web',
    distPath: { root: process.env.BUNDLE_OUT_DIR ?? 'public', js: '' },
    filename: { js: '[name].js' },
    // The output directory holds other files (index.html, action.wasm).
    cleanDistPath: false,
    legalComments: 'none',
    sourceMap: false,
  },
  // RSBuild copies public/ to the output directory by default. The output
  // directory is public/, and the dockerfile copies public/ itself.
  server: { publicDir: false },
  performance: { chunkSplit: { strategy: 'all-in-one' } },
  tools: {
    htmlPlugin: false,
    // ES module output: one file, no runtime chunk loading.
    rspack: {
      experiments: { outputModule: true },
      output: { module: true, chunkFormat: 'module', chunkLoading: 'import' },
    },
  },
});
