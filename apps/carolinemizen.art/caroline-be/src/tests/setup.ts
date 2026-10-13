import { Database } from 'bun:sqlite';
import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDatabase } from '../services/db';

// Test database path
export const TEST_DB_PATH = ':memory:'; // In-memory DB for tests

// The storage provider reads UPLOADS_PATH one time, on first import.
// Without this line, tests write to the production default /app/uploads.
process.env.UPLOADS_PATH ||= mkdtempSync(join(tmpdir(), 'caroline-test-'));

// The database for the tests. An empty DB_PATH makes src/services/db.ts open
// ./database.db, which is the local development database.
const TEST_DB_DIR = mkdtempSync(join(tmpdir(), 'caroline-test-db-'));

// Global test database instance
let testDb: Database | null = null;

export function getTestDb(): Database {
  if (!testDb) {
    testDb = new Database(TEST_DB_PATH);
  }
  return testDb;
}

// Setup: Create fresh database before each test
beforeEach(async () => {
  process.env.DB_PATH = TEST_DB_DIR;
  process.env.TEST_MODE = 'true';

  // Seed database
  await seedDatabase();
});

// Teardown: Clean up after each test
afterEach(() => {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
});
