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

describe('POST /<slug>/notes', () => {
  test('adds a note, writes an audit row with no note text, then goes to the page', async () => {
    const response = await postForm(
      app,
      `/${slug}/notes`,
      { body: ' Owner is Ann ' },
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/acme');
    const note = db.query('SELECT id, body FROM note;').get() as {
      id: string;
      body: string;
    };
    expect(note.body).toBe('Owner is Ann');
    const row = db
      .query("SELECT entity_id, detail FROM audit_log WHERE entity = 'note';")
      .get() as { entity_id: string; detail: string };
    expect(row.entity_id).toBe(note.id);
    expect(row.detail).not.toContain('Ann');
  });

  test('an empty note returns 400 and adds nothing', async () => {
    const response = await postForm(
      app,
      `/${slug}/notes`,
      { body: '   ' },
      cookie,
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('<p role="alert">Type the note.</p>');
    expect(db.query('SELECT count(*) AS n FROM note;').get()).toEqual({ n: 0 });
  });

  test('a slug that does not exist returns 404', async () => {
    const response = await postForm(
      app,
      '/no-such-org/notes',
      { body: 'x' },
      cookie,
    );
    expect(response.statusCode).toBe(404);
  });
});
