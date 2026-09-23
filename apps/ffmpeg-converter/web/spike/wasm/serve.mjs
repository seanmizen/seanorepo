// Static server for the WASM spike. Sends the headers that ffmpeg.wasm
// multi-thread needs (SharedArrayBuffer needs cross-origin isolation).
// ISOLATE=0 turns the headers off, to show what fails without them.
//   node serve.mjs <media dir>

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const nm = join(here, '../../../../../node_modules/@ffmpeg');
const roots = {
  '/ffmpeg/': join(nm, 'ffmpeg/dist/esm'),
  '/util/': join(nm, 'util/dist/esm'),
  '/core/': join(nm, 'core/dist/esm'),
  '/core-mt/': join(nm, 'core-mt/dist/esm'),
  '/media/': process.argv[2] ?? here,
  '/': here,
};
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};
const isolate = process.env.ISOLATE !== '0';

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const prefix = Object.keys(roots).find((p) => path.startsWith(p));
  const file = normalize(
    join(roots[prefix], path.slice(prefix.length) || 'bench.html'),
  );
  try {
    const { size } = statSync(file);
    const headers = {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': size,
    };
    if (isolate) {
      headers['Cross-Origin-Opener-Policy'] = 'same-origin';
      headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
      headers['Cross-Origin-Resource-Policy'] = 'same-origin';
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(Number(process.env.PORT ?? 4060));
