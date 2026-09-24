// Makes small media files for the e2e tests. Needs ffmpeg on PATH.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const FIXTURES = path.join(__dirname, '.fixtures');

/** Chunk size of the Go server under test, so small files go in chunks. */
export const TEST_CHUNK_BYTES = 16 * 1024;

const make: Record<string, string[]> = {
  'clip.mov': [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x240:r=15:d=3',
    '-f',
    'lavfi',
    '-i',
    'sine=d=3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
  ],
  'clip.mp4': [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x240:r=15:d=3',
    '-f',
    'lavfi',
    '-i',
    'sine=d=3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
  ],
  'picture.png': ['-f', 'lavfi', '-i', 'testsrc2=s=64x48', '-frames:v', '1'],
};

export default function globalSetup() {
  mkdirSync(FIXTURES, { recursive: true });
  for (const [name, args] of Object.entries(make)) {
    const out = path.join(FIXTURES, name);
    if (existsSync(out)) continue;
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...args,
      out,
    ]);
  }
}
