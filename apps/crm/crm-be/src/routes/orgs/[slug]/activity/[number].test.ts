import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../../../index';
import {
  addOrg,
  bodyText,
  divOf,
  postForm,
  signInAdmin,
  testApp,
} from '../../../../test-helpers';

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

/**
 * Log a visit or a note with the Log module. Returns its id and its
 * activity number.
 */
const log = async (outcome: string, note: string) => {
  await postForm(app, `/orgs/${slug}/activity`, { outcome, note }, cookie);
  return db
    .query(
      'SELECT id, number FROM visit WHERE note IS ?1 UNION ALL SELECT id, number FROM note WHERE body = ?1;',
    )
    .get(note || null) as { id: string; number: number };
};

const edit = (number: number, fields: Record<string, string>) =>
  postForm(app, `/orgs/${slug}/activity/${number}`, fields, cookie);

const lastAudit = () =>
  db
    .query(
      "SELECT action, entity, entity_id, detail FROM audit_log WHERE action = 'update' ORDER BY rowid DESC;",
    )
    .get() as {
    action: string;
    entity: string;
    entity_id: string;
    detail: string;
  };

describe('GET /orgs/<slug>/activity/<number>', () => {
  test('shows the Log module filled in: the text, and the LED of its key', async () => {
    const { number } = await log('spoke', 'Owner keen');
    expect(number).toBe(1);
    const response = await app.inject({
      method: 'GET',
      url: `/orgs/${slug}/activity/1`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const html = response.body;
    expect(html).toContain(
      '<textarea name="note" placeholder="What happened today?" rows="2">Owner keen</textarea>',
    );
    expect(html).toContain(
      '<button type="submit" class="key latch" aria-pressed="true" value="spoke" name="outcome">Spoke',
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(bodyText(divOf(html, 'lcd'))).toMatch(
      /^Organisation Acme Logged \d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d Type Visit, Spoke$/,
    );
    expect(html).toContain(
      '<form action="/orgs/acme/activity/1" method="post">',
    );
    expect(bodyText(html)).toStartWith('crm / orgs / acme / activity / 1 ');
  });

  test('a note lights Note only, and its type is Note', async () => {
    const { number } = await log('note', 'A note');
    const html = (
      await app.inject({
        method: 'GET',
        url: `/orgs/${slug}/activity/${number}`,
        headers: { cookie },
      })
    ).body;
    expect(html).toContain(
      '<button type="submit" class="key latch" aria-pressed="true" value="note" name="outcome">Note only',
    );
    expect(bodyText(divOf(html, 'lcd'))).toEndWith(' Type Note');
  });

  test('a visit and a note share one counter in each organisation (REQ-CRM-ID-001)', async () => {
    expect((await log('spoke', 'One')).number).toBe(1);
    expect((await log('note', 'Two')).number).toBe(2);
    expect((await log('no_answer', 'Three')).number).toBe(3);
    const other = await addOrg(app, cookie, { name: 'Other' });
    await postForm(
      app,
      `/orgs/${other}/activity`,
      { outcome: 'spoke', note: 'Other one' },
      cookie,
    );
    expect(
      db.query('SELECT number FROM visit WHERE note = ?;').get('Other one'),
    ).toEqual({ number: 1 });
  });

  test('a number of another organisation, an id or a segment that is not a number returns 404', async () => {
    const other = await addOrg(app, cookie, { name: 'Other' });
    const { id } = await log('spoke', 'Here');
    for (const url of [
      `/orgs/${other}/activity/1`,
      `/orgs/${slug}/activity/2`,
      `/orgs/${slug}/activity/${id}`,
      `/orgs/${slug}/activity/0`,
      `/orgs/${slug}/activity/no-such-id`,
    ]) {
      for (const method of ['GET', 'POST'] as const) {
        const response = await app.inject({
          method,
          url,
          headers: {
            cookie,
            'content-type': 'application/x-www-form-urlencoded',
          },
          payload: method === 'POST' ? 'outcome=spoke&note=x' : undefined,
        });
        expect(response.statusCode).toBe(404);
      }
    }
  });
});

describe('POST /orgs/<slug>/activity/<number>', () => {
  test('a different key changes the outcome, and the audit row names the field', async () => {
    const { id, number } = await log('spoke', 'Owner keen');
    const response = await edit(number, {
      outcome: 'call_back',
      note: 'Owner keen',
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/acme');
    expect(db.query('SELECT id, outcome, note FROM visit;').all()).toEqual([
      { id, outcome: 'call_back', note: 'Owner keen' },
    ]);
    const row = lastAudit();
    expect(row).toMatchObject({ entity: 'visit', entity_id: id });
    expect(JSON.parse(row.detail)).toEqual({
      organisation_id: expect.any(String),
      fields: ['outcome'],
      saved_as: 'call_back',
    });
  });

  test('Note only changes a visit to a note, and an outcome changes a note to a visit, with the same id, number and time', async () => {
    await log('note', 'First');
    const { id, number } = await log('spoke', 'Owner keen');
    expect(number).toBe(2);
    const at = (db.query('SELECT at FROM visit;').get() as { at: string }).at;
    await edit(number, { outcome: 'note', note: 'Owner keen' });
    expect(db.query('SELECT count(*) AS n FROM visit;').get()).toEqual({
      n: 0,
    });
    expect(
      db
        .query(
          'SELECT id, number, body, created_at FROM note WHERE number = 2;',
        )
        .all(),
    ).toEqual([{ id, number, body: 'Owner keen', created_at: at }]);
    expect(JSON.parse(lastAudit().detail)).toMatchObject({
      fields: ['outcome'],
      was: 'visit',
    });

    await edit(number, { outcome: 'no_answer', note: '' });
    expect(db.query('SELECT count(*) AS n FROM note;').get()).toEqual({ n: 1 });
    expect(
      db.query('SELECT id, number, at, outcome, note FROM visit;').all(),
    ).toEqual([{ id, number, at, outcome: 'no_answer', note: null }]);
    expect(JSON.parse(lastAudit().detail)).toMatchObject({
      fields: ['outcome', 'note'],
      was: 'note',
    });
  });

  test('a change to the text keeps the key, and the audit row has no text', async () => {
    const { number } = await log('note', 'Old text');
    await edit(number, { outcome: 'note', note: 'New text' });
    expect(db.query('SELECT body FROM note;').all()).toEqual([
      { body: 'New text' },
    ]);
    expect(lastAudit().detail).not.toContain('text');
    expect(JSON.parse(lastAudit().detail).fields).toEqual(['note']);
  });

  test('a save with no change writes nothing', async () => {
    const { number } = await log('spoke', 'Same');
    await edit(number, { outcome: 'spoke', note: 'Same' });
    expect(
      db
        .query("SELECT count(*) AS n FROM audit_log WHERE action = 'update';")
        .get(),
    ).toEqual({ n: 0 });
  });

  test('a change to "Do not knock" sets the stage to lost', async () => {
    const { number } = await log('spoke', 'Hi');
    await edit(number, { outcome: 'do_not_knock', note: 'Hi' });
    expect(db.query('SELECT stage FROM organisation;').get()).toEqual({
      stage: 'lost',
    });
  });

  test('Note only with no text returns 400 and changes nothing', async () => {
    const { number } = await log('spoke', 'Hi');
    const response = await edit(number, { outcome: 'note', note: '' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Type a visit note, then tap Note only.</p>',
    );
    expect(db.query('SELECT outcome FROM visit;').get()).toEqual({
      outcome: 'spoke',
    });
  });
});
