import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';

type DatabaseType = InstanceType<typeof Database>;

/**
 * Open a connection to the SQLite file.
 *
 * Callers open a fresh connection per operation and `close()` it in a
 * `finally` — the database is a file right next to the runner, so there is no
 * pool to manage and no cross-request state to leak.
 */
const openDbConnection = async (): Promise<DatabaseType> => {
  const directory = process.env.DB_PATH ?? '.';
  // A missing directory is a legitimate first-run state — a fresh volume, a
  // temp dir for a test, a new machine. SQLite will not create it and fails
  // with SQLITE_CANTOPEN, which reads like a permissions problem rather than
  // the plain "no such folder" it is.
  mkdirSync(directory, { recursive: true });

  const db = new Database(`${directory}/database.db`);
  // SQLite leaves foreign keys off by default; every connection must opt in.
  db.run('PRAGMA foreign_keys = ON');
  return db;
};

export { openDbConnection };
export type { DatabaseType };
