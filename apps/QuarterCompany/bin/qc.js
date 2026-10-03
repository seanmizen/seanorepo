#!/usr/bin/env node
// Yarn runs package bins with Node. QuarterCompany runs on Bun, so this
// launcher starts the real CLI with Bun.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'cli.ts',
);
const r = spawnSync('bun', [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
if (r.error) {
  console.error(
    `qc: Bun did not start (${r.error.message}). Install Bun, and put it on PATH.`,
  );
  process.exit(1);
}
process.exit(r.status ?? 1);
