// Copies ffmpeg.wasm (the FFmpeg class and the core files) from
// node_modules into public/ffmpeg,
// so the site serves them from its own origin. The files are 30+ MB each,
// so git ignores them and every dev and build run copies them again.

import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'public', 'ffmpeg');

function findPackage(name) {
  for (let dir = web; dir !== dirname(dir); dir = dirname(dir)) {
    const p = join(dir, 'node_modules', name);
    if (existsSync(p)) return p;
  }
  throw new Error(`${name} is not installed. Run yarn install.`);
}

rmSync(out, { recursive: true, force: true });
// The FFmpeg class is copied too, not bundled. Its worker imports the core
// with a runtime import(), and webpack breaks that.
for (const [pkg, to] of [
  ['@ffmpeg/ffmpeg', 'ffmpeg'],
  ['@ffmpeg/core', 'core'],
  ['@ffmpeg/core-mt', 'core-mt'],
]) {
  cpSync(join(findPackage(pkg), 'dist', 'esm'), join(out, to), {
    recursive: true,
  });
}
