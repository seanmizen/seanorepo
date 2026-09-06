import { defineConfig, devices } from '@playwright/test';

const FE_PORT = 4160;
const BE_PORT = 4161;

/**
 * E2E runs the real frontend against the real backend.
 *
 * Ports are deliberately offset from the dev ports (4060/4061) so a running
 * `yarn start` doesn't collide with a test run, and the backend gets a
 * throwaway DB and uploads dir under /tmp.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: `http://localhost:${FE_PORT}`,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: `bun src/index.ts`,
      cwd: '../inside-be',
      url: `http://localhost:${BE_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(BE_PORT),
        NODE_ENV: 'test',
        DB_PATH: '/tmp/inside-e2e',
        UPLOADS_PATH: '/tmp/inside-e2e/uploads',
        UPLOADS_URL: `http://localhost:${BE_PORT}/api/uploads`,
        JWT_SECRET: 'e2e-jwt-secret',
        COOKIE_SECRET: 'e2e-cookie-secret',
        CORS_ORIGIN: `http://localhost:${FE_PORT}`,
        FRONTEND_URL: `http://localhost:${FE_PORT}`,
        // Lets the auth specs complete a real sign-in without SMTP: the
        // magic link comes back in the response instead of an email.
        DANGEROUS_BYPASS_EMAIL_MAGIC_LINK: 'true',
        ADMIN_EMAILS: 'admin@inside.test',
      },
    },
    {
      command: `yarn rsbuild dev --port ${FE_PORT}`,
      url: `http://localhost:${FE_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        API_URL: `http://localhost:${BE_PORT}/api`,
      },
    },
  ],
});
