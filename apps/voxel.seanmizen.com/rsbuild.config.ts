// The JS bundles of voxel.seanmizen.com. bundle.sh runs RSBuild two times,
// one time for each environment:
//
//   worker  zig-out/swindowzig/backends/wasm/chunk-worker.ts ->
//           $BUNDLE_OUT_DIR/chunk-worker.js. bundle.sh then gives the file
//           a content-hashed name.
//   boot    src/boot.ts (with the swindowzig wasm loader) ->
//           $BUNDLE_OUT_DIR/boot.js. CHUNKS_WASM_URL and CHUNK_WORKER_URL
//           give the hashed names to __CHUNKS_WASM_URL__ and
//           __CHUNK_WORKER_URL__. Without them, boot.js starts no chunk
//           workers.
//
// Each bundle is one ES module file with a fixed name, and no HTML.
// index.html loads boot.js with <script type="module">, and the loader
// starts the worker with `new Worker(url, { type: 'module' })`.

import { defineConfig, type RsbuildConfig } from '@rsbuild/core';

const outDir = process.env.BUNDLE_OUT_DIR ?? 'public';

function define(): Record<string, string> {
  const wasm = process.env.CHUNKS_WASM_URL;
  const worker = process.env.CHUNK_WORKER_URL;
  if (!wasm || !worker) return {};
  return {
    __CHUNKS_WASM_URL__: JSON.stringify(wasm),
    __CHUNK_WORKER_URL__: JSON.stringify(worker),
  };
}

export default defineConfig({
  environments: {
    worker: {
      source: {
        entry: {
          'chunk-worker': './zig-out/swindowzig/backends/wasm/chunk-worker.ts',
        },
      },
    },
    boot: {
      source: { entry: { boot: './src/boot.ts' }, define: define() },
    },
  },
  output: {
    target: 'web',
    distPath: { root: outDir, js: '' },
    filename: { js: '[name].js' },
    // The output directory holds other files (index.html, app.wasm).
    cleanDistPath: false,
    legalComments: 'none',
    sourceMap: false,
  },
  // RSBuild copies public/ to the output directory by default. bundle.sh
  // writes into public/, and build.sh copies the other files itself.
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
} satisfies RsbuildConfig);
