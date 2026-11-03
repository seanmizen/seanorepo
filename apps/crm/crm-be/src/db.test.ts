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

/**
 * A folder with the migrations up to and with `last` (for example `004`),
 * as a database was before the next one.
 */
const upTo = (last: string) => {
  const folder = path.join(dir, `up-to-${last}`);
  mkdirSync(folder);
  for (const name of readdirSync(MIGRATIONS_DIR)) {
    if (name.slice(0, 3) <= last) {
      copyFileSync(path.join(MIGRATIONS_DIR, name), path.join(folder, name));
    }
  }
  return folder;
};

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
      'org_event',
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
  test('005 fills org_event from the old history of each organisation, in time order (REQ-CRM-UNDO-001)', () => {
    const db = new Database(file, { create: true, strict: true });
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db, upTo('004'));
    const run = (sql: string, ...values: (string | null)[]) =>
      db.query(sql).run(...values);
    const audit = (
      at: string,
      action: string,
      entity: string,
      entityId: string,
      detail: object,
    ) =>
      run(
        'INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?);',
        crypto.randomUUID(),
        `2026-01-0${at}`,
        'p-admin',
        action,
        entity,
        entityId,
        JSON.stringify(detail),
      );
    run(
      "INSERT INTO organisation (id, slug, name, stage, created_at) VALUES ('a', 'a', 'A', 'lost', '2026-01-01T10:00:00.000Z');",
    );
    run(
      "INSERT INTO organisation (id, slug, name, created_at) VALUES ('empty', 'empty', 'Empty', '2026-01-02T10:00:00.000Z');",
    );
    audit('1T10:00:00.000Z', 'create', 'organisation', 'a', { stage: 'lead' });
    run("INSERT INTO person (id, name) VALUES ('p1', 'Ann');");
    audit('1T10:00:00.000Z', 'create', 'person', 'p1', {
      organisation_id: 'a',
    });
    run(
      "INSERT INTO membership (person_id, organisation_id, role, number) VALUES ('p1', 'a', 'owner', 1);",
    );
    audit('1T10:00:00.000Z', 'create', 'membership', 'a', {
      person_id: 'p1',
      role: 'owner',
    });
    // A visit with do_not_knock, and the change of stage at the same time.
    run(
      "INSERT INTO visit (id, organisation_id, number, at, outcome) VALUES ('v1', 'a', 2, '2026-01-03T10:00:00.000Z', 'do_not_knock');",
    );
    audit('3T10:00:00.000Z', 'update', 'organisation', 'a', {
      fields: ['stage', 'next_action', 'next_action_on'],
      from: 'lead',
      stage: 'lost',
      next_action_on: null,
      cleared: true,
    });
    // The note is older than the visit: the order is by time.
    run(
      "INSERT INTO note (id, organisation_id, number, body, created_at) VALUES ('n1', 'a', 1, 'Hi', '2026-01-02T10:00:00.000Z');",
    );
    audit('4T10:00:00.000Z', 'update', 'note', 'n1', {
      organisation_id: 'a',
      fields: ['note'],
      saved_as: 'note',
    });
    audit('5T10:00:00.000Z', 'update', 'organisation', 'a', {
      fields: ['postcode'],
    });
    audit('6T10:00:00.000Z', 'update', 'person', 'p1', {
      organisation_id: 'a',
      fields: ['phone'],
    });
    audit('7T10:00:00.000Z', 'delete', 'membership', 'a', { person_id: 'p1' });
    // Rows that are not about an organisation stay out.
    audit('7T10:00:00.000Z', 'sign_in', 'session', 's1', { method: 'email' });

    expect(migrate(db)[0]).toBe('005-events.sql');
    const events = db
      .query<
        {
          organisation_id: string;
          number: number;
          kind: string;
          payload: string;
        },
        []
      >(
        'SELECT organisation_id, number, kind, payload FROM org_event ORDER BY organisation_id, number;',
      )
      .all()
      .map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
    expect(
      events.map((e) => `${e.organisation_id} ${e.number} ${e.kind}`),
    ).toEqual([
      'a 1 create',
      'a 2 contact_add',
      'a 3 note',
      'a 4 visit',
      'a 5 stage',
      'a 6 activity_edit',
      'a 7 details',
      'a 8 contact_edit',
      'a 9 contact_remove',
      'empty 1 create',
    ]);
    // Each one is marked migrated. Only a visit or a note has changes, so
    // Undo can hide it: audit_log kept no old values.
    expect(events.every((e) => e.payload.migrated === true)).toBe(true);
    expect(events.filter((e) => e.payload.changes).map((e) => e.kind)).toEqual([
      'note',
      'visit',
    ]);
    expect(events[3].payload).toEqual({
      record_id: 'v1',
      migrated: true,
      changes: [
        {
          table: 'visit',
          id: 'v1',
          before: { hidden: true },
          after: { hidden: false },
        },
      ],
    });
    expect(events[4].payload).toMatchObject({ from: 'lead', stage: 'lost' });
    expect(events[5].payload).toMatchObject({
      record_id: 'n1',
      fields: ['note'],
    });
    expect(events[7].payload).toMatchObject({
      person_id: 'p1',
      fields: ['phone'],
    });
    expect(events[8].payload).toEqual({ person_id: 'p1', migrated: true });
    expect(
      db
        .query("SELECT actor FROM org_event WHERE organisation_id = 'empty';")
        .get(),
    ).toEqual({ actor: 'migration' });
    // The new columns: no record is hidden.
    expect(
      db
        .query(
          `SELECT (SELECT count(*) FROM visit WHERE hidden_at IS NOT NULL)
                + (SELECT count(*) FROM note WHERE hidden_at IS NOT NULL)
                + (SELECT count(*) FROM membership WHERE hidden_at IS NOT NULL) AS n;`,
        )
        .get(),
    ).toEqual({ n: 0 });
    db.close();
  });

  test('005 on a database with no rows adds the tables and no event (REQ-CRM-UNDO-001)', () => {
    const db = new Database(file, { create: true, strict: true });
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db, upTo('004'));
    expect(migrate(db)[0]).toBe('005-events.sql');
    expect(db.query('SELECT count(*) AS n FROM org_event;').get()).toEqual({
      n: 0,
    });
    db.close();
  });
});
