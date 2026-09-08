import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DatabaseType, openDbConnection } from './db';

// Migrations run inside the test suite too. The progress chatter would bury
// assertion output there.
const log = (...args: unknown[]): void => {
  if (process.env.NODE_ENV !== 'test') console.log(...args);
};

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

interface Migration {
  version: number;
  filename: string;
  sql: string;
}

/** Read `NNN_name.sql` files from the migrations directory, ordered by version. */
function getMigrationFiles(): Migration[] {
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    return files.map((filename) => {
      const version = Number.parseInt(filename.split('_')[0], 10);
      if (Number.isNaN(version)) {
        throw new Error(
          `Migration "${filename}" must start with a numeric version, e.g. 001_add_thing.sql`,
        );
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
      return { version, filename, sql };
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // Migrations directory doesn't exist yet.
      return [];
    }
    throw error;
  }
}

/**
 * Versions already applied.
 *
 * Tracked by presence rather than a `MAX(version)` high-water mark, so a
 * migration merged out of order still runs, and version 000 is legal.
 *
 * This tracking is also why REQ-DATA-001 forbids editing an applied migration:
 * presence means an edited file is never re-run, so the change reaches only
 * fresh databases and every existing one silently keeps the old schema.
 */
function getAppliedVersions(db: DatabaseType): Set<number> {
  const rows = db
    .query('SELECT version FROM schema_migrations')
    .all() as Array<{ version: number }>;
  return new Set(rows.map((row) => row.version));
}

/**
 * Apply every migration not yet recorded. REQ-DATA-002: a second run against an
 * already-migrated database applies nothing, which matters because this runs on
 * every boot — deploy, crash restart, server reboot. A runner that is not
 * idempotent turns an ordinary restart into a schema change.
 *
 * Each migration's DDL and its `schema_migrations` row are committed in one
 * transaction, so a failure part-way through a file can't leave applied DDL
 * unrecorded.
 */
export async function runMigrations(): Promise<void> {
  const db = await openDbConnection();

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const applied = getAppliedVersions(db);
    const pending = getMigrationFiles().filter((m) => !applied.has(m.version));

    if (pending.length === 0) {
      log(`[Migrations] No pending migrations (${applied.size} applied)`);
      return;
    }

    log(`[Migrations] Found ${pending.length} pending migration(s)`);

    for (const migration of pending) {
      log(`[Migrations] Applying ${migration.version}: ${migration.filename}`);

      const apply = db.transaction(() => {
        db.exec(migration.sql);
        db.run(
          'INSERT INTO schema_migrations (version, filename) VALUES (?, ?)',
          [migration.version, migration.filename],
        );
      });

      try {
        apply();
        log(
          `[Migrations] ✓ Applied ${migration.version}: ${migration.filename}`,
        );
      } catch (error) {
        console.error(
          `[Migrations] ✗ Failed to apply ${migration.version}:`,
          error,
        );
        throw error;
      }
    }

    log('[Migrations] All migrations applied successfully');
  } finally {
    db.close();
  }
}
