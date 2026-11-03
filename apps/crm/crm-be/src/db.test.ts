import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate, openDatabase } from './db';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'crm-migrate-'));
  file = path.join(dir, 'crm.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const tableNames = (db: ReturnType<typeof openDatabase>) =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    )
    .all()
    .map((row) => row.name);

describe('migrations', () => {
  test('a fresh database gets every table', () => {
    const db = openDatabase(file);
    expect(tableNames(db)).toEqual([
      'audit_log',
      'login_token',
      'membership',
      'note',
      'organisation',
      'passkey',
      'person',
      'recovery_token',
      'schema_migrations',
      'session',
      'visit',
      'webauthn_challenge',
    ]);
    const applied = db
      .query<{ name: string }, []>('SELECT name FROM schema_migrations;')
      .all();
    expect(applied.map((row) => row.name)).toContain('001-init.sql');
    db.close();
  });

  test('a second boot applies nothing', () => {
    openDatabase(file).close();
    const db = openDatabase(file);
    expect(migrate(db)).toEqual([]);
    db.close();
  });

  test('a bad stage value fails', () => {
    const db = openDatabase(file);
    const insert = db.query(
      'INSERT INTO organisation (id, slug, name, stage) VALUES (?, ?, ?, ?);',
    );
    insert.run(crypto.randomUUID(), 'good', 'Good Ltd', 'quoted');
    expect(() =>
      insert.run(crypto.randomUUID(), 'bad', 'Bad Ltd', 'maybe'),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });

  test('foreign keys are on', () => {
    const db = openDatabase(file);
    expect(() =>
      db
        .query('INSERT INTO note (id, organisation_id, body) VALUES (?, ?, ?);')
        .run(crypto.randomUUID(), 'no-such-organisation', 'hello'),
    ).toThrow(/FOREIGN KEY constraint failed/);
    db.close();
  });
});
