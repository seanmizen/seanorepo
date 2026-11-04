import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../../index';
import {
  addOrg,
  lastEvent,
  postForm,
  signInAdmin,
  TEST_ADMIN_EMAIL,
  testApp,
} from '../../../test-helpers';

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
  test('sets the stage and the next action, writes an event and an audit row, then goes to the page', async () => {
    const response = await postForm(
      app,
      `/orgs/${slug}/stage`,
      {
        stage: 'quoted',
        next_action: 'Chase quote',
        next_action_on: '2030-01-02',
      },
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/acme');
    expect(org()).toEqual({
      stage: 'quoted',
      next_action: 'Chase quote',
      next_action_on: '2030-01-02',
    });
    const row = db
      .query(
        "SELECT actor, entity, detail FROM audit_log WHERE action = 'stage';",
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
    // The audit row has the event number, the names of the changed fields
    // and the stage before and after. It never has the text of the next
    // action.
    const display = {
      fields: ['stage', 'next_action', 'next_action_on'],
      from: 'lead',
      stage: 'quoted',
      next_action_on: '2030-01-02',
      cleared: false,
    };
    expect(JSON.parse(row.detail)).toEqual({ number: 2, ...display });
    // The event also has the values before and after, for Undo and Redo.
    expect(lastEvent(db)).toEqual({
      kind: 'stage',
      ...display,
      changes: [
        {
          table: 'organisation',
          id: expect.any(String),
          before: { stage: 'lead', next_action: null, next_action_on: null },
          after: {
            stage: 'quoted',
            next_action: 'Chase quote',
            next_action_on: '2030-01-02',
          },
        },
      ],
    });

    const html = (
      await app.inject({
        method: 'GET',
        url: '/orgs/acme',
        headers: { cookie },
      })
    ).body;
    expect(html).toContain(
      '<button type="submit" class="key latch" aria-pressed="true" value="quoted" name="stage">Quoted<span class="latch-state" aria-hidden="true"> (current)</span> <span class="sub">1</span></button>',
    );
    expect(html).toContain(
      '<dt>Next action</dt><dd class="value">Chase quote</dd>',
    );
    expect(html).toContain(
      '<time dateTime="2030-01-02T00:00:00+00:00" title="2030-Jan-02 00:00:00">2030-Jan-02</time>',
    );
  });

  test('a post that changes nothing writes no event and no audit row', async () => {
    const rows = () =>
      db
        .query(
          "SELECT (SELECT count(*) FROM audit_log WHERE entity = 'organisation') + (SELECT count(*) FROM org_event) AS n;",
        )
        .get();
    const before = rows();
    await postForm(app, `/orgs/${slug}/stage`, { stage: 'lead' }, cookie);
    expect(rows()).toEqual(before);
  });

  test('empty values clear the next action', async () => {
    await postForm(
      app,
      `/orgs/${slug}/stage`,
      { stage: 'lead', next_action: 'x', next_action_on: '2030-01-02' },
      cookie,
    );
    await postForm(
      app,
      `/orgs/${slug}/stage`,
      { stage: 'lead', next_action: '', next_action_on: '' },
      cookie,
    );
    expect(org()).toEqual({
      stage: 'lead',
      next_action: null,
      next_action_on: null,
    });
  });

  test('Lost clears the next action, and Undo gives it back', async () => {
    await postForm(
      app,
      `/orgs/${slug}/stage`,
      {
        stage: 'quoted',
        next_action: 'Chase quote',
        next_action_on: '2000-01-02',
      },
      cookie,
    );
    // The Stage module sends the next action as it is.
    await postForm(
      app,
      `/orgs/${slug}/stage`,
      {
        stage: 'lost',
        next_action: 'Chase quote',
        next_action_on: '2000-01-02',
      },
      cookie,
    );
    expect(org()).toEqual({
      stage: 'lost',
      next_action: null,
      next_action_on: null,
    });
    const event = lastEvent(db) as { cleared: boolean };
    expect(event.cleared).toBe(true);
    const undo = await postForm(
      app,
      `/orgs/${slug}/undo`,
      { event: '3' },
      cookie,
    );
    expect(undo.statusCode).toBe(303);
    expect(org()).toEqual({
      stage: 'quoted',
      next_action: 'Chase quote',
      next_action_on: '2000-01-02',
    });
  });

  test('a stage or a date that is not valid returns 400 and changes nothing', async () => {
    const bad = await postForm(
      app,
      `/orgs/${slug}/stage`,
      { stage: 'nope' },
      cookie,
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain(
      '<p role="alert" class="status"><span>Choose a stage.</span></p>',
    );
    const badDate = await postForm(
      app,
      `/orgs/${slug}/stage`,
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
      '/orgs/no-such-org/stage',
      { stage: 'won' },
      cookie,
    );
    expect(response.statusCode).toBe(404);
  });
});
