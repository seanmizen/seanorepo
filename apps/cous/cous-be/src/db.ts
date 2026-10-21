import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ScoreInput } from './validation';

/** The number of scores on the leaderboard. */
const TOP_N = 10;

type ScoreRow = { name: string; score: number; createdAt: string };

type ScoreStore = {
  top: () => ScoreRow[];
  add: (input: ScoreInput) => void;
  close: () => void;
};

/**
 * Opens the SQLite file at `path` and makes the table if it does not exist.
 * Use ':memory:' for a database that only the tests use.
 */
const openScoreStore = (path: string): ScoreStore => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run('PRAGMA journal_mode = WAL');
  db.run(`CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  db.run(
    'CREATE INDEX IF NOT EXISTS scores_rank ON scores (score DESC, id ASC)',
  );

  // The earlier score keeps the higher place when two scores are equal.
  const topQuery = db.query<ScoreRow, [number]>(
    `SELECT name, score, created_at AS createdAt FROM scores
     ORDER BY score DESC, id ASC LIMIT ?`,
  );
  const insert = db.query(
    'INSERT INTO scores (name, score, duration_ms) VALUES (?, ?, ?)',
  );

  return {
    top: () => topQuery.all(TOP_N),
    add: ({ name, score, durationMs }) => {
      insert.run(name, score, Math.round(durationMs));
    },
    close: () => db.close(),
  };
};

export { openScoreStore, TOP_N };
export type { ScoreRow, ScoreStore };
