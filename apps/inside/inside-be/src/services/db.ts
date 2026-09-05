import { Database } from 'bun:sqlite';

type DatabaseType = InstanceType<typeof Database>;

/**
 * Open a connection to the SQLite file.
 *
 * Callers open a fresh connection per operation and `close()` it in a
 * `finally` — the database is a file right next to the runner, so there is no
 * pool to manage and no cross-request state to leak.
 */
const openDbConnection = async (): Promise<DatabaseType> => {
  const dbPath = process.env.DB_PATH
    ? `${process.env.DB_PATH}/database.db`
    : './database.db';

  const db = new Database(dbPath);
  // SQLite leaves foreign keys off by default; every connection must opt in.
  db.run('PRAGMA foreign_keys = ON');
  return db;
};

export { openDbConnection };
export type { DatabaseType };
