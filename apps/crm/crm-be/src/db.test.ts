import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIGRATIONS_DIR, migrate, openDatabase } from './db';

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
      'connection',
      'login_token',
      'membership',
      'note',
      'oauth_client',
      'oauth_code',
      'org_counter',
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
        .query(
          'INSERT INTO note (id, organisation_id, number, body) VALUES (?, ?, 1, ?);',
        )
        .run(crypto.randomUUID(), 'no-such-organisation', 'hello'),
    ).toThrow(/FOREIGN KEY constraint failed/);
    db.close();
  });

  test('004 numbers the existing records of each organisation in creation order, and starts the counters (REQ-CRM-ID-001)', () => {
    // A database at 003, as it was before the numbers.
    const before = path.join(dir, 'before');
    mkdirSync(before);
    for (const name of readdirSync(MIGRATIONS_DIR)) {
      if (name < '004') {
        copyFileSync(path.join(MIGRATIONS_DIR, name), path.join(before, name));
      }
    }
    const db = new Database(file, { create: true, strict: true });
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db, before);
    const run = (sql: string, ...values: string[]) =>
      db.query(sql).run(...values);
    for (const org of ['a', 'b', 'empty']) {
      run(
        'INSERT INTO organisation (id, slug, name) VALUES (?, ?, ?);',
        org,
        org,
        org,
      );
    }
    for (const person of ['p1', 'p2', 'p3']) {
      run('INSERT INTO person (id, name) VALUES (?, ?);', person, person);
    }
    // p3 is a contact of a and b: a number in each.
    for (const [person, org] of [
      ['p2', 'a'],
      ['p3', 'b'],
      ['p1', 'a'],
      ['p3', 'a'],
    ]) {
      run(
        "INSERT INTO membership (person_id, organisation_id, role) VALUES (?, ?, 'owner');",
        person,
        org,
      );
    }
    // The rows are not in time order: the number follows the time.
    run(
      "INSERT INTO visit (id, organisation_id, at, outcome) VALUES ('v-late', 'a', '2026-03-01T10:00:00.000Z', 'spoke');",
    );
    run(
      "INSERT INTO note (id, organisation_id, body, created_at) VALUES ('n-mid', 'a', 'x', '2026-02-01T10:00:00.000Z');",
    );
    run(
      "INSERT INTO visit (id, organisation_id, at, outcome) VALUES ('v-early', 'a', '2026-01-01T10:00:00.000Z', 'no_answer');",
    );
    run(
      "INSERT INTO note (id, organisation_id, body, created_at) VALUES ('n-b', 'b', 'y', '2026-01-01T10:00:00.000Z');",
    );

    // 004 runs first, then each later migration.
    expect(migrate(db)).toEqual(
      readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql') && name >= '004')
        .sort(),
    );
    expect(
      db
        .query(
          'SELECT organisation_id, person_id, number FROM membership ORDER BY organisation_id, number;',
        )
        .all(),
    ).toEqual([
      { organisation_id: 'a', person_id: 'p2', number: 1 },
      { organisation_id: 'a', person_id: 'p1', number: 2 },
      { organisation_id: 'a', person_id: 'p3', number: 3 },
      { organisation_id: 'b', person_id: 'p3', number: 1 },
    ]);
    expect(
      db
        .query(
          `SELECT organisation_id, id, number FROM visit
           UNION ALL SELECT organisation_id, id, number FROM note
           ORDER BY organisation_id, number;`,
        )
        .all(),
    ).toEqual([
      { organisation_id: 'a', id: 'v-early', number: 1 },
      { organisation_id: 'a', id: 'n-mid', number: 2 },
      { organisation_id: 'a', id: 'v-late', number: 3 },
      { organisation_id: 'b', id: 'n-b', number: 1 },
    ]);
    expect(
      db
        .query(
          'SELECT organisation_id, kind, last FROM org_counter ORDER BY organisation_id, kind;',
        )
        .all(),
    ).toEqual([
      { organisation_id: 'a', kind: 'activity', last: 3 },
      { organisation_id: 'a', kind: 'contact', last: 3 },
      { organisation_id: 'b', kind: 'activity', last: 1 },
      { organisation_id: 'b', kind: 'contact', last: 1 },
    ]);
    // A number is unique in its organisation.
    expect(() =>
      run(
        "INSERT INTO note (id, organisation_id, number, body) VALUES ('n-dup', 'a', 2, 'z');",
      ),
    ).toThrow(/UNIQUE constraint failed/);
    db.close();
  });
});
