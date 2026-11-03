import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../../index';
import { addOrg, postForm, signInAdmin, testApp } from '../../../test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let cookie: string;
let slug: string;

beforeEach(async () => {
  ({ app, db, close } = testApp());
  cookie = signInAdmin(app);
  slug = await addOrg(app, cookie, { name: 'Acme' });
});

afterEach(async () => {
  await close();
});

const log = (fields: Record<string, string>) =>
  postForm(app, `/orgs/${slug}/activity`, fields, cookie);

const visits = () => db.query('SELECT outcome, note FROM visit;').all();
const notes = () => db.query('SELECT body FROM note;').all();

const audits = () =>
  db
    .query(
      "SELECT action, entity, detail FROM audit_log WHERE action = 'update' OR entity IN ('visit', 'note') ORDER BY rowid;",
    )
    .all() as { action: string; entity: string; detail: string }[];

describe('POST /orgs/<slug>/activity (the Log module)', () => {
  test('a Save as key with no note logs a visit (1 tap), and writes an audit row', async () => {
    const response = await log({ outcome: 'no_answer', note: '' });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/acme');
    expect(visits()).toEqual([{ outcome: 'no_answer', note: null }]);
    const [row] = audits();
    expect(row).toMatchObject({ action: 'create', entity: 'visit' });
    expect(JSON.parse(row.detail).outcome).toBe('no_answer');
  });

  test('keeps the visit note, and the audit row does not copy it', async () => {
    await log({ outcome: 'call_back', note: ' After 5pm ' });
    expect(visits()).toEqual([{ outcome: 'call_back', note: 'After 5pm' }]);
    expect(audits()[0].detail).not.toContain('5pm');
  });

  test('Note only saves the text as a note, with no visit', async () => {
    await log({ outcome: 'note', note: ' Owner is Ann ' });
    expect(notes()).toEqual([{ body: 'Owner is Ann' }]);
    expect(visits()).toEqual([]);
    const [row] = audits();
    expect(row).toMatchObject({ action: 'create', entity: 'note' });
    expect(row.detail).not.toContain('Ann');
  });

  test('Note only with no text returns 400 and adds nothing', async () => {
    const response = await log({ outcome: 'note', note: '  ' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Type a visit note, then tap Note only.</p>',
    );
    expect(notes()).toEqual([]);
  });

  test('"Do not knock" also sets the stage to lost and clears the next action', async () => {
    await postForm(
      app,
      `/orgs/${slug}/stage`,
      {
        stage: 'visited',
        next_action: 'Knock again',
        next_action_on: '2000-01-01',
      },
      cookie,
    );
    await log({ outcome: 'do_not_knock' });
    expect(
      db
        .query('SELECT stage, next_action, next_action_on FROM organisation;')
        .get(),
    ).toEqual({ stage: 'lost', next_action: null, next_action_on: null });
    expect(audits().map((row) => `${row.action} ${row.entity}`)).toEqual([
      'update organisation',
      'create visit',
      'update organisation',
    ]);
    expect(JSON.parse(audits()[2].detail)).toMatchObject({
      from: 'visited',
      stage: 'lost',
    });
  });

  test('the other outcomes leave the stage as it is', async () => {
    await log({ outcome: 'not_interested' });
    expect(db.query('SELECT stage FROM organisation;').get()).toEqual({
      stage: 'lead',
    });
  });

  test('a value that is not a Save as key returns 400 and logs nothing', async () => {
    const response = await log({ outcome: 'maybe' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Tap one of the Save as buttons.</p>',
    );
    expect(visits()).toEqual([]);
  });

  test('a slug that does not exist returns 404', async () => {
    const response = await postForm(
      app,
      '/orgs/no-such-org/activity',
      { outcome: 'spoke' },
      cookie,
    );
    expect(response.statusCode).toBe(404);
  });
});
