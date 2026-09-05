import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Isolated environment for one test file.
 *
 * Every suite gets its own temp directory for the database and uploads, so
 * tests never touch a developer's real `database.db` and can run in parallel
 * without fighting each other. (caroline-be's equivalent claims `:memory:`
 * but actually seeds `./database.db` — don't copy that.)
 *
 * Env vars are set BEFORE importing anything from `src/`, because the server
 * and storage modules read them at module scope.
 */
export interface TestEnv {
  dir: string;
  dbPath: string;
  uploadsPath: string;
  cleanup: () => void;
}

export function createTestEnv(prefix = 'inside-test'): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const dbPath = dir;
  const uploadsPath = join(dir, 'uploads');

  process.env.DB_PATH = dbPath;
  process.env.UPLOADS_PATH = uploadsPath;
  process.env.UPLOADS_URL = 'http://localhost:4061/api/uploads';
  process.env.STORAGE_TYPE = 'local';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.COOKIE_SECRET = 'test-cookie-secret';
  process.env.CORS_ORIGIN = 'http://localhost:4060';
  // Never let a test think it is production — that path throws on secrets.
  process.env.NODE_ENV = 'test';

  return {
    dir,
    dbPath,
    uploadsPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
