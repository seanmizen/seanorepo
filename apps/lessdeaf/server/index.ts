// Where: apps/lessdeaf/server/index.ts
// When: `bun server/index.ts` (yarn workspace lessdeaf start, and the docker
// image).
// Why: one Bun process serves the lessdeaf API on PORT (4100).
//
// Environment:
//   PORT               default 4100
//   LESSDEAF_DATA_DIR  the session folders. Production: the named volume /data.
//   LESSDEAF_KEY       the key that the phone sends. Without it, every route
//                      except /api/health answers 503.

import { join, resolve } from 'node:path';
import { createHandler, MAX_CHUNK_BYTES, MIN_KEY_CHARS } from './app';
import { createStore } from './store';

const root = resolve(import.meta.dir, '..');
const PORT = Number(process.env.PORT ?? 4100);
const dataDir = resolve(process.env.LESSDEAF_DATA_DIR ?? join(root, 'data'));
const key = process.env.LESSDEAF_KEY ?? '';

const store = createStore(dataDir);
await store.init();

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  maxRequestBodySize: MAX_CHUNK_BYTES * 2,
  fetch: createHandler({ store, key }),
});

console.log(`lessdeaf: http://localhost:${PORT} (data ${dataDir})`);
if (key.length < MIN_KEY_CHARS)
  console.warn(
    `lessdeaf: uploads are off. Set LESSDEAF_KEY (${MIN_KEY_CHARS} characters or more) to turn them on.`,
  );
