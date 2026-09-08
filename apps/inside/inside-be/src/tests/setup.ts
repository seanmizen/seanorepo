import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Shared test environment.
 *
 * `bun test` runs every suite in ONE process, and the modules under test
 * capture their configuration at module scope — `services/storage/index.ts`
 * reads UPLOADS_PATH on import, and `src/index.ts` builds the Fastify instance
 * on import. Those imports stay cached, so all suites unavoidably share one
 * server and one storage provider.
 *
 * Giving each suite its own env therefore does not isolate anything. It just
 * means whichever suite loaded first wins, and whichever calls `app.close()`
 * first breaks the others. So this creates the environment once per process and
 * torn down at exit, and suites share it deliberately rather than by accident.
 *
 * Tests must stay independent by using unique data (unique emails, unique
 * filenames) rather than by assuming a clean database.
 */
export interface TestEnv {
  dir: string;
  dbPath: string;
  uploadsPath: string;
}

let env: TestEnv | null = null;

export function getTestEnv(): TestEnv {
  if (env) return env;

  const dir = mkdtempSync(join(tmpdir(), 'inside-test-'));
  const uploadsPath = join(dir, 'uploads');

  process.env.DB_PATH = dir;
  process.env.UPLOADS_PATH = uploadsPath;
  process.env.UPLOADS_URL = 'http://localhost:4061/api/uploads';
  process.env.STORAGE_TYPE = 'local';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.COOKIE_SECRET = 'test-cookie-secret';
  process.env.CORS_ORIGIN = 'http://localhost:4060';
  process.env.FRONTEND_URL = 'http://localhost:4060';
  process.env.DANGEROUS_BYPASS_EMAIL_MAGIC_LINK = 'true';
  process.env.ADMIN_EMAILS = 'boss@inside.test';
  // Never let a suite look like production — that path throws on dev secrets.
  process.env.NODE_ENV = 'test';

  env = { dir, dbPath: dir, uploadsPath };

  // One teardown for the process. A per-suite afterAll would delete the
  // database out from under suites still running.
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

  return env;
}

let appPromise: Promise<FastifyInstance> | null = null;

/**
 * The shared, migrated, ready Fastify instance.
 *
 * Deliberately never closed by a suite — see above. The process exiting closes
 * it, and `inject()` needs no listening socket.
 */
export function getApp(): Promise<FastifyInstance> {
  if (appPromise) return appPromise;

  appPromise = (async () => {
    getTestEnv();
    const { runMigrations } = await import('../services/migrations');
    await runMigrations();
    const { app } = await import('../index');
    await app.ready();
    return app;
  })();

  return appPromise;
}

/** Unique per call, so suites sharing a database never collide on data. */
let counter = 0;
export const uniqueEmail = (prefix = 'user'): string =>
  `${prefix}-${Date.now()}-${counter++}@inside.test`;
