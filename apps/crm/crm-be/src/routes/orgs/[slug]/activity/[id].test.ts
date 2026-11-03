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

/** Log a visit or a note with the Log module. Returns its id. */
const log = async (outcome: string, note: string) => {
  await postForm(app, `/orgs/${slug}/activity`, { outcome, note }, cookie);
  const row = db
    .query(
      'SELECT id FROM visit WHERE note IS ?1 UNION ALL SELECT id FROM note WHERE body = ?1;',
    )
    .get(note || null) as { id: string };
  return row.id;
};

const edit = (id: string, fields: Record<string, string>) =>
  postForm(app, `/orgs/${slug}/activity/${id}`, fields, cookie);

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

describe('GET /orgs/<slug>/activity/<id>', () => {
  test('shows the Log module filled in: the text, and the LED of its key', async () => {
    const id = await log('spoke', 'Owner keen');
    const response = await app.inject({
      method: 'GET',
      url: `/orgs/${slug}/activity/${id}`,
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
      /^Organisation Acme Logged \d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d Saved as Spoke$/,
    );
    expect(html).toContain(
      `<form action="/orgs/acme/activity/${id}" method="post">`,
    );
  });

  test('a note lights Note only', async () => {
    const id = await log('note', 'A note');
    const html = (
      await app.inject({
        method: 'GET',
        url: `/orgs/${slug}/activity/${id}`,
        headers: { cookie },
      })
    ).body;
    expect(html).toContain(
      '<button type="submit" class="key latch" aria-pressed="true" value="note" name="outcome">Note only',
    );
  });

  test('an id of another organisation, or no id, returns 404', async () => {
    const other = await addOrg(app, cookie, { name: 'Other' });
    const id = await log('spoke', 'Here');
    for (const url of [
      `/orgs/${other}/activity/${id}`,
      `/orgs/${slug}/activity/no-such-id`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(404);
    }
  });
});

describe('POST /orgs/<slug>/activity/<id>', () => {
  test('a different key changes the outcome, and the audit row names the field', async () => {
    const id = await log('spoke', 'Owner keen');
    const response = await edit(id, {
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

  test('Note only changes a visit to a note, and an outcome changes a note to a visit, with the same id and time', async () => {
    const id = await log('spoke', 'Owner keen');
    const at = (db.query('SELECT at FROM visit;').get() as { at: string }).at;
    await edit(id, { outcome: 'note', note: 'Owner keen' });
    expect(db.query('SELECT count(*) AS n FROM visit;').get()).toEqual({
      n: 0,
    });
    expect(db.query('SELECT id, body, created_at FROM note;').all()).toEqual([
      { id, body: 'Owner keen', created_at: at },
    ]);
    expect(JSON.parse(lastAudit().detail)).toMatchObject({
      fields: ['outcome'],
      was: 'visit',
    });

    await edit(id, { outcome: 'no_answer', note: '' });
    expect(db.query('SELECT count(*) AS n FROM note;').get()).toEqual({ n: 0 });
    expect(db.query('SELECT id, at, outcome, note FROM visit;').all()).toEqual([
      { id, at, outcome: 'no_answer', note: null },
    ]);
    expect(JSON.parse(lastAudit().detail)).toMatchObject({
      fields: ['outcome', 'note'],
      was: 'note',
    });
  });

  test('a change to the text keeps the key, and the audit row has no text', async () => {
    const id = await log('note', 'Old text');
    await edit(id, { outcome: 'note', note: 'New text' });
    expect(db.query('SELECT body FROM note;').all()).toEqual([
      { body: 'New text' },
    ]);
    expect(lastAudit().detail).not.toContain('text');
    expect(JSON.parse(lastAudit().detail).fields).toEqual(['note']);
  });

  test('a save with no change writes nothing', async () => {
    const id = await log('spoke', 'Same');
    await edit(id, { outcome: 'spoke', note: 'Same' });
    expect(
      db
        .query("SELECT count(*) AS n FROM audit_log WHERE action = 'update';")
        .get(),
    ).toEqual({ n: 0 });
  });

  test('a change to "Do not knock" sets the stage to lost', async () => {
    const id = await log('spoke', 'Hi');
    await edit(id, { outcome: 'do_not_knock', note: 'Hi' });
    expect(db.query('SELECT stage FROM organisation;').get()).toEqual({
      stage: 'lost',
    });
  });

  test('Note only with no text returns 400 and changes nothing', async () => {
    const id = await log('spoke', 'Hi');
    const response = await edit(id, { outcome: 'note', note: '' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Type a visit note, then tap Note only.</p>',
    );
    expect(db.query('SELECT outcome FROM visit;').get()).toEqual({
      outcome: 'spoke',
    });
  });
});
