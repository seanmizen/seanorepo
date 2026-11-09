/**
 * The runs and the saved value of each job, in SQLite. In prod the file is
 * in the named volume `cron_data` (DB_PATH=/data/cron.db).
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Status } from './job';

/** Runs older than this are deleted. */
export const KEEP_DAYS = 30;
/** The longest detail that a run keeps. */
export const MAX_DETAIL = 64 * 1024;

export interface Run {
  id: number;
  job: string;
  startedAt: string;
  durationMs: number;
  status: Status;
  summary: string;
  detail: string | null;
}

export const openDb = (path: string) => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      job TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_job ON runs (job, id);
    CREATE TABLE IF NOT EXISTS state (
      job TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
};

export type Db = ReturnType<typeof openDb>;

const COLUMNS = `id, job, started_at AS startedAt, duration_ms AS durationMs,
  status, summary, detail`;

export const addRun = (db: Db, run: Omit<Run, 'id'>) => {
  const detail =
    run.detail && run.detail.length > MAX_DETAIL
      ? `${run.detail.slice(0, MAX_DETAIL)}\n[cut at ${MAX_DETAIL} characters]`
      : run.detail;
  db.query(
    `INSERT INTO runs (job, started_at, duration_ms, status, summary, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    run.job,
    run.startedAt,
    run.durationMs,
    run.status,
    run.summary,
    detail,
  );
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  db.query('DELETE FROM runs WHERE started_at < ?').run(cutoff);
};

/** The newest runs of a job, newest first. */
export const recentRuns = (db: Db, job: string, limit: number) =>
  db
    .query(`SELECT ${COLUMNS} FROM runs WHERE job = ? ORDER BY id DESC LIMIT ?`)
    .all(job, limit) as Run[];

/** The newest run of a job that is not `ok`, or null. */
export const lastNotable = (db: Db, job: string) =>
  (db
    .query(
      `SELECT ${COLUMNS} FROM runs WHERE job = ? AND status != 'ok'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(job) as Run | null) ?? null;

export const loadState = <T>(db: Db, job: string): T | undefined => {
  const row = db.query('SELECT value FROM state WHERE job = ?').get(job) as {
    value: string;
  } | null;
  return row ? (JSON.parse(row.value) as T) : undefined;
};

export const saveState = (db: Db, job: string, value: unknown) => {
  db.query(
    `INSERT INTO state (job, value) VALUES (?, ?)
     ON CONFLICT (job) DO UPDATE SET value = excluded.value`,
  ).run(job, JSON.stringify(value));
};
