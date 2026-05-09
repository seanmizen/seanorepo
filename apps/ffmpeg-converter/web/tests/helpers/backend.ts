// Shared helpers for Playwright specs. Keep this module dependency-free
// (no Playwright imports at top-level) so the helpers can be invoked from
// `test.beforeAll` blocks without circular import grief.

import fs from 'node:fs';
import path from 'node:path';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:9876';

/**
 * Probe the Go backend's /health endpoint. Returns true when the backend is
 * reachable AND reports `status: ok`. Used by conversion-flow specs to
 * skip themselves if the backend isn't running (e.g. CI without Go).
 */
export async function backendIsLive(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { status?: string };
    return json.status === 'ok';
  } catch {
    return false;
  }
}

export const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');

export function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/**
 * Verify every fixture file the suite needs exists. Surfaces a clear
 * "run yarn test:fixtures" message if a developer forgets the prereq.
 */
export function ensureFixtures(): void {
  const required = [
    'tiny.mov',
    'tiny.mp4',
    'tiny.webm',
    'tiny.gif',
    'broken.mp4',
    'tiny.png',
    'tiny.jpg',
  ];
  const missing = required.filter(
    (f) => !fs.existsSync(path.join(FIXTURES_DIR, f)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing fixtures: ${missing.join(', ')}.\n` +
        `Run: yarn workspace ffmpeg-converter-next test:fixtures`,
    );
  }
}

/**
 * Read a fixture as raw bytes — used to drag/drop files into the page via
 * `setInputFiles({ buffer })` without re-encoding.
 */
export function fixtureBuffer(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}
