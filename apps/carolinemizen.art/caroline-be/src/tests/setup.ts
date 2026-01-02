import { Database } from 'bun:sqlite';
import { afterEach, beforeEach } from 'bun:test';
import { seedDatabase } from '../services/db';

// Test database path
export const TEST_DB_PATH = ':memory:'; // In-memory DB for tests

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
  // Override DB_PATH for tests
  process.env.DB_PATH = '';
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
