import { Database } from 'bun:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The SQLite file. Set DB_PATH to change it. The default is in `crm-be/data/`,
 * which git ignores. Never put the live file in a synced folder (see
 * docs/001-guiding-design.md, "SQLite and backups").
 */
export const DB_PATH =
  process.env.DB_PATH || path.join(import.meta.dir, '..', 'data', 'crm.db');

/**
 * The numbered SQL files (`001-init.sql`, ...). The path is relative to this
 * file, so it is the same in tests, in dev and in Docker.
 */
export const MIGRATIONS_DIR = path.join(import.meta.dir, '..', 'migrations');

/**
 * Apply each new `.sql` file in `dir`, in name order. Each file runs once, in
 * its own transaction, and its name goes into `schema_migrations`. There are
 * no down migrations. Returns the names of the files that this call applied.
 */
export const migrate = (db: Database, dir = MIGRATIONS_DIR): string[] => {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);
  const done = new Set(
    db
      .query<{ name: string }, []>('SELECT name FROM schema_migrations;')
      .all()
      .map((row) => row.name),
  );
  const pending = readdirSync(dir)
    .filter((name) => name.endsWith('.sql') && !done.has(name))
    .sort();
  for (const name of pending) {
    const sql = readFileSync(path.join(dir, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.query(
        'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?);',
      ).run(name, new Date().toISOString());
    })();
  }
  return pending;
};

/**
 * Open (or create) the SQLite file at `file`, in WAL mode, with foreign keys
 * on. Then apply the new migrations.
 */
export const openDatabase = (file: string): Database => {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL;');
  // In production, Litestream checkpoints the WAL from its own container.
  // While it holds the lock, a write waits up to 5 s and does not fail with
  // SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000;');
  // SQLite ignores this PRAGMA in a transaction, so set it before migrate().
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
};
