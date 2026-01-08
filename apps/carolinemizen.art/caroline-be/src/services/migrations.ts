import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDbConnection } from './db';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

interface Migration {
  version: number;
  filename: string;
  sql: string;
}

/**
 * Get all migration files from the migrations directory
 */
function getMigrationFiles(): Migration[] {
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    return files.map((filename) => {
      const version = Number.parseInt(filename.split('_')[0], 10);
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
      return { version, filename, sql };
    });
  } catch (_error) {
    // Migrations directory doesn't exist yet
    return [];
  }
}

/**
 * Get the current schema version from the database
 */
function getCurrentVersion(
  db: Awaited<ReturnType<typeof openDbConnection>>,
): number {
  try {
    const result = db
      .query('SELECT MAX(version) as version FROM schema_migrations')
      .get() as { version: number | null };
    return result.version || 0;
  } catch {
    // schema_migrations table doesn't exist yet
    return 0;
  }
}

/**
 * Run pending database migrations
 * Creates schema_migrations table if it doesn't exist
 * Runs all migrations newer than the current version
 */
export async function runMigrations(): Promise<void> {
  const db = await openDbConnection();

  try {
    // Create schema_migrations table if it doesn't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const currentVersion = getCurrentVersion(db);
    const migrations = getMigrationFiles();
    const pendingMigrations = migrations.filter(
      (m) => m.version > currentVersion,
    );

    if (pendingMigrations.length === 0) {
      console.log(
        `[Migrations] No pending migrations (current version: ${currentVersion})`,
      );
      return;
    }

    console.log(
      `[Migrations] Found ${pendingMigrations.length} pending migration(s)`,
    );

    for (const migration of pendingMigrations) {
      console.log(
        `[Migrations] Applying migration ${migration.version}: ${migration.filename}`,
      );

      try {
        // Run the migration SQL
        db.exec(migration.sql);

        // Record the migration
        db.run(
          'INSERT INTO schema_migrations (version, filename) VALUES (?, ?)',
          [migration.version, migration.filename],
        );

        console.log(
          `[Migrations] ✓ Applied migration ${migration.version}: ${migration.filename}`,
        );
      } catch (error) {
        console.error(
          `[Migrations] ✗ Failed to apply migration ${migration.version}:`,
          error,
        );
        throw error;
      }
    }

    console.log('[Migrations] All migrations applied successfully');
  } finally {
    db.close();
  }
}
