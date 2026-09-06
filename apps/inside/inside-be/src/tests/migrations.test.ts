import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { getTestEnv } from './setup';

const env = getTestEnv();

// Imported after getTestEnv so DB_PATH is already set.
const { runMigrations } = await import('../services/migrations');

const open = () => new Database(join(env.dbPath, 'database.db'));

describe('migration runner', () => {
  test('applies the baseline schema to a fresh database', async () => {
    await runMigrations();

    const db = open();
    const tables = (
      db
        .query("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    db.close();

    for (const expected of [
      'users',
      'magic_tokens',
      'sessions',
      'images',
      'image_variants',
      'schema_migrations',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  test('records what it applied', () => {
    const db = open();
    const rows = db
      .query('SELECT version, filename FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; filename: string }>;
    db.close();

    expect(rows.length).toBeGreaterThan(0);
    // The baseline is version 0 — a MAX(version) high-water mark would never
    // have run it, which is why tracking is by presence.
    expect(rows[0].version).toBe(0);
  });

  test('is idempotent — a second run applies nothing', async () => {
    const before = (() => {
      const db = open();
      const n = (
        db.query('SELECT COUNT(*) c FROM schema_migrations').get() as {
          c: number;
        }
      ).c;
      db.close();
      return n;
    })();

    await runMigrations();

    const db = open();
    const after = (
      db.query('SELECT COUNT(*) c FROM schema_migrations').get() as {
        c: number;
      }
    ).c;
    db.close();

    expect(after).toBe(before);
  });
});

describe('schema constraints actually bite', () => {
  test('rejects a role outside the CHECK list', () => {
    const db = open();
    expect(() =>
      db.run("INSERT INTO users (email, role) VALUES ('a@b.c', 'wizard')"),
    ).toThrow();
    db.close();
  });

  test('accepts a valid role', () => {
    const db = open();
    expect(() =>
      db.run("INSERT INTO users (email, role) VALUES ('ok@b.c', 'designer')"),
    ).not.toThrow();
    db.close();
  });

  test('enforces foreign keys when the pragma is on', () => {
    const db = open();
    db.run('PRAGMA foreign_keys = ON');
    expect(() =>
      db.run(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (99999, 'x', '2099-01-01')",
      ),
    ).toThrow();
    db.close();
  });

  test('rejects a duplicate email', () => {
    const db = open();
    db.run("INSERT INTO users (email) VALUES ('dupe@b.c')");
    expect(() =>
      db.run("INSERT INTO users (email) VALUES ('dupe@b.c')"),
    ).toThrow();
    db.close();
  });
});
