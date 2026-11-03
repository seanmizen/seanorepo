import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../index';
import { addOrg, postForm, signIn, testApp } from '../../test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let cookie: string;
let slug: string;

beforeEach(async () => {
  ({ app, db, close } = testApp());
  cookie = await signIn(app, db, 'sean@example.com');
  slug = await addOrg(app, cookie, { name: 'Acme' });
});

afterEach(async () => {
  await close();
});

const visits = () => db.query('SELECT outcome, note FROM visit;').all();

const audits = () =>
  db
    .query(
      "SELECT action, entity, detail FROM audit_log WHERE action = 'update' OR entity = 'visit' ORDER BY rowid;",
    )
    .all() as { action: string; entity: string; detail: string }[];

describe('POST /<slug>/visits', () => {
  test('one outcome key logs a visit with no note (1 tap), and writes an audit row', async () => {
    const response = await postForm(
      app,
      `/${slug}/visits`,
      { outcome: 'no_answer', note: '' },
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/acme');
    expect(visits()).toEqual([{ outcome: 'no_answer', note: null }]);
    const [row] = audits();
    expect(row).toMatchObject({ action: 'create', entity: 'visit' });
    expect(JSON.parse(row.detail).outcome).toBe('no_answer');
  });

  test('keeps the optional note', async () => {
    await postForm(
      app,
      `/${slug}/visits`,
      { outcome: 'call_back', note: ' After 5pm ' },
      cookie,
    );
    expect(visits()).toEqual([{ outcome: 'call_back', note: 'After 5pm' }]);
  });

  test('"do_not_knock" also sets the stage to lost and clears the next action', async () => {
    await postForm(
      app,
      `/${slug}/stage`,
      {
        stage: 'visited',
        next_action: 'Knock again',
        next_action_on: '2000-01-01',
      },
      cookie,
    );
    await postForm(app, `/${slug}/visits`, { outcome: 'do_not_knock' }, cookie);
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
    const today = (
      await app.inject({ method: 'GET', url: '/', headers: { cookie } })
    ).body;
    expect(today).toContain('Nothing is due');
  });

  test('the other outcomes leave the stage as it is', async () => {
    await postForm(
      app,
      `/${slug}/visits`,
      { outcome: 'not_interested' },
      cookie,
    );
    expect(db.query('SELECT stage FROM organisation;').get()).toEqual({
      stage: 'lead',
    });
  });

  test('an outcome that is not valid returns 400 and logs nothing', async () => {
    const response = await postForm(
      app,
      `/${slug}/visits`,
      { outcome: 'maybe' },
      cookie,
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('<p role="alert">Choose an outcome.</p>');
    expect(visits()).toEqual([]);
  });

  test('a slug that does not exist returns 404', async () => {
    const response = await postForm(
      app,
      '/no-such-org/visits',
      { outcome: 'spoke' },
      cookie,
    );
    expect(response.statusCode).toBe(404);
  });
});
