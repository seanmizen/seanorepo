import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { TEST_CHUNK_BYTES } from './tests/fixtures';

// Starts the real Go service (needs ffmpeg on PATH) and the Next.js site,
// then runs the browser flows in tests/.
const GO_DIR = path.resolve(__dirname, '..');

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/fixtures.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:4050',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'go run .',
      cwd: GO_DIR,
      url: 'http://localhost:9876/health',
      env: {
        DATA_DIR: path.join(GO_DIR, 'data', 'e2e'),
        // Tiny chunks, so the small test files upload in several chunks.
        UPLOAD_CHUNK_BYTES: String(TEST_CHUNK_BYTES),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'yarn dev',
      url: 'http://localhost:4050',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
