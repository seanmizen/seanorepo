// Playwright config for the seansconverter.com (ffmpeg-converter) Next.js
// frontend. SEAN-113.
//
// Architecture notes:
//   - The frontend dev server runs on port 4050 (`next dev --port 4050`).
//   - The Go backend runs on port 9876. The Next.js `/api/*` route proxies
//     to it; if it's offline the proxy falls back to an in-memory mock so
//     pure-frontend tests (file routing, axe a11y, lighthouse) still work.
//   - Conversion-flow tests need the real backend. They self-skip when
//     no backend is reachable on :9876 (see tests/helpers/backend.ts).
//
// Process orchestration:
//   - Playwright starts `yarn workspace ffmpeg-converter-next dev` and waits
//     for the port to accept connections.
//   - The Go backend is the developer's responsibility. Run it manually in
//     a second terminal (`cd apps/ffmpeg-converter && go run .`) before
//     invoking `yarn test:e2e` if you want the conversion-flow specs to run.
//   - Or run `yarn workspace ffmpeg-converter start` in one terminal — that
//     concurrently boots both — and then `yarn test:e2e` in another.

import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const FE_PORT = 4050;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // file uploads share a backend; serial keeps logs sane
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${FE_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      // Next.js dev server. `cwd` is the workspace root so the Yarn 4
      // workspace resolution picks up the right `next` binary.
      command: `yarn workspace ffmpeg-converter-next dev`,
      cwd: REPO_ROOT,
      url: `http://localhost:${FE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
