import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../../index';
import {
  addOrg,
  lastEvent,
  postForm,
  signInAdmin,
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

const log = (fields: Record<string, string>) =>
  postForm(app, `/orgs/${slug}/activity`, fields, cookie);

const visits = () => db.query('SELECT outcome, note FROM visit;').all();
const notes = () => db.query('SELECT body FROM note;').all();

/**
 * The audit rows of the changes to the organisation, after its `create`
 * row. Each event writes one (`writeEvent` in `events.ts`).
 */
const audits = () =>
  db
    .query(
      "SELECT action, entity, detail FROM audit_log WHERE entity = 'organisation' AND action != 'create' ORDER BY rowid;",
    )
    .all() as { action: string; entity: string; detail: string }[];

describe('POST /orgs/<slug>/activity (the Log module)', () => {
  test('a Save as key with no note logs a visit (1 tap), and writes an event and an audit row', async () => {
    const response = await log({ outcome: 'no_answer', note: '' });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/acme');
    expect(visits()).toEqual([{ outcome: 'no_answer', note: null }]);
    expect(lastEvent(db)).toMatchObject({
      kind: 'visit',
      outcome: 'no_answer',
    });
    const [row] = audits();
    expect(row).toMatchObject({ action: 'visit', entity: 'organisation' });
    expect(JSON.parse(row.detail)).toMatchObject({
      number: 2,
      outcome: 'no_answer',
    });
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
    expect(row).toMatchObject({ action: 'note', entity: 'organisation' });
    expect(row.detail).not.toContain('Ann');
  });

  test('Note only with no text returns 400 and adds nothing', async () => {
    const response = await log({ outcome: 'note', note: '  ' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert" class="status"><span>Type a visit note, then tap Note only.</span></p>',
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
    // One event: the visit and the change of stage, so one Undo reverses
    // both.
    expect(audits().map((row) => row.action)).toEqual(['stage', 'visit']);
    expect(JSON.parse(audits()[1].detail).pipeline).toMatchObject({
      from: 'visited',
      stage: 'lost',
    });
    // The list has no due next action, so no LED is lit.
    const list = (
      await app.inject({ method: 'GET', url: '/', headers: { cookie } })
    ).body;
    expect(list).not.toContain('class="led on"');
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
      '<p role="alert" class="status"><span>Tap Note only or one of the Save as visit buttons.</span></p>',
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
