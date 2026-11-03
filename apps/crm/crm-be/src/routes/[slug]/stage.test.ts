import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../index';
import {
  addOrg,
  postForm,
  signInAdmin,
  TEST_ADMIN_EMAIL,
  testApp,
} from '../../test-helpers';

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

const org = () =>
  db
    .query(
      'SELECT stage, next_action, next_action_on FROM organisation WHERE slug = ?;',
    )
    .get(slug);

describe('POST /<slug>/stage', () => {
  test('sets the stage and the next action, writes an audit row, then goes to the page', async () => {
    const response = await postForm(
      app,
      `/${slug}/stage`,
      {
        stage: 'quoted',
        next_action: 'Chase quote',
        next_action_on: '2030-01-02',
      },
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/acme');
    expect(org()).toEqual({
      stage: 'quoted',
      next_action: 'Chase quote',
      next_action_on: '2030-01-02',
    });
    const row = db
      .query(
        "SELECT actor, entity, detail FROM audit_log WHERE action = 'update';",
      )
      .get() as { actor: string; entity: string; detail: string };
    expect(row.entity).toBe('organisation');
    expect(row.actor).toBe(
      (
        db
          .query('SELECT id FROM person WHERE email = ?;')
          .get(TEST_ADMIN_EMAIL) as { id: string }
      ).id,
    );
    expect(JSON.parse(row.detail)).toEqual({
      stage: 'quoted',
      next_action_on: '2030-01-02',
    });

    const html = (
      await app.inject({ method: 'GET', url: '/acme', headers: { cookie } })
    ).body;
    expect(html).toContain(
      '<option value="quoted" selected="">Quoted</option>',
    );
    expect(html).toContain(
      'Chase quote on <time dateTime="2030-01-02">2030-01-02</time>',
    );
  });

  test('empty values clear the next action', async () => {
    await postForm(
      app,
      `/${slug}/stage`,
      { stage: 'lead', next_action: 'x', next_action_on: '2030-01-02' },
      cookie,
    );
    await postForm(
      app,
      `/${slug}/stage`,
      { stage: 'lead', next_action: '', next_action_on: '' },
      cookie,
    );
    expect(org()).toEqual({
      stage: 'lead',
      next_action: null,
      next_action_on: null,
    });
  });

  test('a stage or a date that is not valid returns 400 and changes nothing', async () => {
    const bad = await postForm(
      app,
      `/${slug}/stage`,
      { stage: 'nope' },
      cookie,
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('<p role="alert">Choose a stage.</p>');
    const badDate = await postForm(
      app,
      `/${slug}/stage`,
      { stage: 'won', next_action_on: 'tomorrow' },
      cookie,
    );
    expect(badDate.statusCode).toBe(400);
    expect(org()).toEqual({
      stage: 'lead',
      next_action: null,
      next_action_on: null,
    });
  });

  test('a slug that does not exist returns 404', async () => {
    const response = await postForm(
      app,
      '/no-such-org/stage',
      { stage: 'won' },
      cookie,
    );
    expect(response.statusCode).toBe(404);
  });
});
