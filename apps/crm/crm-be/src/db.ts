import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The SQLite file. Set DB_PATH to change it. The default is in `crm-be/data/`,
 * which git ignores. Never put the live file in a synced folder (see
 * docs/001-guiding-design.md, "SQLite and backups").
 */
export const DB_PATH =
  process.env.DB_PATH || path.join(import.meta.dir, '..', 'data', 'crm.db');

/** Open (or create) the SQLite file at `file`, in WAL mode. */
export const openDatabase = (file: string): Database => {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
};
