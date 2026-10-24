// Where: apps/autosam/server/index.ts
// When: `bun server/index.ts` (yarn workspace autosam start, and the docker
// image).
// Why: one Bun process serves the page and the song API on PORT (4090).
//
// Environment:
//   PORT               default 4090
//   AUTOSAM_DATA_DIR   the songs folder. Production: the named volume /data.
//   AUTOSAM_SEED_DIR   the songs that the repo ships (songs/). init() copies
//                      each one once.
//   AUTOSAM_EDIT_KEY   the key that lets a visitor add, change, archive and
//                      restore songs. Without it, the songs are read-only.

import { join, resolve } from 'node:path';
import { createHandler, MAX_BODY_BYTES, MIN_KEY_CHARS } from './app';
import { createStore } from './store';

const root = resolve(import.meta.dir, '..');
const PORT = Number(process.env.PORT ?? 4090);
const dataDir = resolve(process.env.AUTOSAM_DATA_DIR ?? join(root, 'data'));
const seedDir = resolve(process.env.AUTOSAM_SEED_DIR ?? join(root, 'songs'));
const editKey = process.env.AUTOSAM_EDIT_KEY ?? '';

const store = createStore(dataDir, seedDir);
await store.init();
const handle = await createHandler({
  store,
  publicDir: join(root, 'public'),
  editKey,
});

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  maxRequestBodySize: MAX_BODY_BYTES * 2,
  fetch: handle,
});

console.log(`autosam: http://localhost:${PORT} (data ${dataDir})`);
if (editKey.length < MIN_KEY_CHARS)
  console.warn(
    `autosam: editing is off. Set AUTOSAM_EDIT_KEY (${MIN_KEY_CHARS} characters or more) to turn it on.`,
  );
