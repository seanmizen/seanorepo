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
  slug = await addOrg(app, cookie, {
    name: 'Acme Plumbing',
    address_line_1: '1 High Street',
    postcode: 'SW1A 1AA',
    source: 'door',
  });
});

afterEach(async () => {
  await close();
});

const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { cookie } });

const save = (fields: Record<string, string>) =>
  postForm(app, `/orgs/${slug}/edit`, fields, cookie);

const current = {
  name: 'Acme Plumbing',
  source: 'door',
  slug: 'acme-plumbing',
  address_line_1: '1 High Street',
  address_line_2: '',
  postcode: 'SW1A 1AA',
};

const lastAudit = () =>
  db
    .query(
      "SELECT detail FROM audit_log WHERE action = 'update' ORDER BY rowid DESC;",
    )
    .get() as { detail: string } | null;

describe('/orgs/<slug>/edit', () => {
  test('GET shows the form of /orgs/new, filled in, and says that old links stop working', async () => {
    const html = (await get(`/orgs/${slug}/edit`)).body;
    expect(html).toContain(
      '<form action="/orgs/acme-plumbing/edit" method="post">',
    );
    expect(html).toContain(
      '<input required="" name="name" value="Acme Plumbing"/>',
    );
    expect(html).toContain('name="slug" value="acme-plumbing"');
    expect(html).toContain('name="postcode" value="SW1A 1AA"');
    expect(html).toContain(
      'When the URL name changes, old links to this organisation stop working.',
    );
  });

  test('POST saves the fields, and the audit row has the names of the changed fields', async () => {
    const response = await save({
      ...current,
      name: 'Acme Plumbing Ltd',
      postcode: 'e1 6an',
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/acme-plumbing');
    expect(
      db.query('SELECT name, postcode, slug FROM organisation;').get(),
    ).toEqual({
      name: 'Acme Plumbing Ltd',
      postcode: 'E1 6AN',
      slug: 'acme-plumbing',
    });
    expect(JSON.parse(lastAudit()?.detail ?? '{}')).toEqual({
      fields: ['name', 'postcode'],
    });
  });

  test('a new URL name moves the page, and the old address no longer opens it', async () => {
    const response = await save({ ...current, slug: 'acme' });
    expect(response.headers.location).toBe('/orgs/acme');
    expect((await get('/orgs/acme')).statusCode).toBe(200);
    expect((await get('/orgs/acme-plumbing')).statusCode).toBe(404);
    expect(JSON.parse(lastAudit()?.detail ?? '{}').fields).toEqual(['slug']);
  });

  test('an empty URL name comes from the name', async () => {
    await save({ ...current, slug: '', name: 'Bravo Builders' });
    expect(db.query('SELECT slug FROM organisation;').get()).toEqual({
      slug: 'bravo-builders',
    });
  });

  test('a URL name that another organisation has returns 400 and changes nothing', async () => {
    await addOrg(app, cookie, { name: 'Other' });
    const response = await save({ ...current, slug: 'other' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Another organisation has this URL name.</p>',
    );
    expect(response.body).toContain('name="slug" value="other"');
    expect(
      db
        .query('SELECT slug FROM organisation WHERE name = ?;')
        .get('Acme Plumbing'),
    ).toEqual({
      slug: 'acme-plumbing',
    });
  });

  test('with no name, returns 400', async () => {
    const response = await save({ ...current, name: '' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Type the name of the organisation.</p>',
    );
  });

  test('a save with no change writes no audit row', async () => {
    await save(current);
    expect(lastAudit()).toBeNull();
  });
});
