import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../../index';
import {
  addOrg,
  addPerson,
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

const add = (fields: Record<string, string>, to = slug) =>
  postForm(app, `/orgs/${to}/contacts`, fields, cookie);

const contacts = () =>
  db
    .query(
      `SELECT person.name, person.phone, person.email, membership.role, organisation.slug
       FROM membership JOIN person ON person.id = membership.person_id
       JOIN organisation ON organisation.id = membership.organisation_id
       ORDER BY person.rowid;`,
    )
    .all();

const personId = (name: string) =>
  (
    db.query('SELECT id FROM person WHERE name = ?;').get(name) as {
      id: string;
    }
  ).id;

describe('POST /orgs/<slug>/contacts (Add a contact)', () => {
  test('adds a person and a membership, each with an audit row with no contact details', async () => {
    const response = await add({
      name: 'Ann Smith',
      phone: '07700 900000',
      email: 'Ann@Example.com',
      role: 'staff',
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/acme');
    expect(contacts()).toEqual([
      {
        name: 'Ann Smith',
        phone: '07700 900000',
        email: 'ann@example.com',
        role: 'staff',
        slug: 'acme',
      },
    ]);
    const rows = db
      .query(
        "SELECT action, entity, detail FROM audit_log WHERE entity IN ('person', 'membership') ORDER BY rowid;",
      )
      .all() as { action: string; entity: string; detail: string }[];
    expect(rows.map((row) => `${row.action} ${row.entity}`)).toEqual([
      'create person',
      'create membership',
    ]);
    expect(rows.map((row) => row.detail).join()).not.toMatch(
      /Ann|07700|example/,
    );
  });

  test('links the person that has the email, as /orgs/new does', async () => {
    const existing = addPerson(db, 'ann@example.com');
    const other = await addOrg(app, cookie, { name: 'Other' });
    await add({ email: 'ANN@example.com', role: 'owner' }, other);
    expect(db.query('SELECT person_id FROM membership;').all()).toEqual([
      { person_id: existing },
    ]);
  });

  test('a person who is a contact already returns 400', async () => {
    await add({ email: 'ann@example.com' });
    const response = await add({ email: 'ann@example.com' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">A contact of this organisation has this email address.</p>',
    );
  });

  test('with no name, phone or email, returns 400 and keeps the typed values', async () => {
    const response = await add({ name: ' ', role: 'staff' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Type a name, a phone number or an email address.</p>',
    );
    expect(response.body).toContain('<option value="staff" selected="">');
    const bad = await add({ name: 'Ann', email: 'not an email' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('value="not an email"');
    expect(contacts()).toEqual([]);
  });
});

describe('/orgs/<slug>/contacts/<person-id>', () => {
  test('GET shows the contact form of Add a contact, filled in', async () => {
    await add({ name: 'Ann', phone: '07700 900000', role: 'staff' });
    const html = (
      await app.inject({
        method: 'GET',
        url: `/orgs/${slug}/contacts/${personId('Ann')}`,
        headers: { cookie },
      })
    ).body;
    expect(html).toContain('<h2 class="label">Contact</h2>');
    expect(html).toContain('name="name" value="Ann"');
    expect(html).toContain('type="tel" name="phone" value="07700 900000"');
    expect(html).toContain('<option value="staff" selected="">Staff</option>');
  });

  test('POST saves the person and the role, and each audit row names only the changed fields', async () => {
    await add({ name: 'Ann', phone: '07700 900000' });
    const id = personId('Ann');
    const response = await postForm(
      app,
      `/orgs/${slug}/contacts/${id}`,
      { name: 'Ann Jones', phone: '07700 900000', email: '', role: 'staff' },
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(contacts()).toEqual([
      {
        name: 'Ann Jones',
        phone: '07700 900000',
        email: null,
        role: 'staff',
        slug: 'acme',
      },
    ]);
    const rows = db
      .query(
        "SELECT entity, detail FROM audit_log WHERE action = 'update' ORDER BY rowid;",
      )
      .all() as { entity: string; detail: string }[];
    expect(
      rows.map((row) => [row.entity, JSON.parse(row.detail).fields]),
    ).toEqual([
      ['person', ['name']],
      ['membership', ['role']],
    ]);
    expect(rows.map((row) => row.detail).join()).not.toContain('Jones');
  });

  test('an email that another person has returns 400 and changes nothing', async () => {
    addPerson(db, 'taken@example.com');
    await add({ name: 'Ann' });
    const response = await postForm(
      app,
      `/orgs/${slug}/contacts/${personId('Ann')}`,
      { name: 'Ann', email: 'taken@example.com', role: 'owner' },
      cookie,
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Another person has this email address.</p>',
    );
    expect(response.body).toContain('value="taken@example.com"');
  });

  test('the page names the other organisations of the person', async () => {
    await add({ name: 'Ann', email: 'ann@example.com' });
    const other = await addOrg(app, cookie, { name: 'Other Ltd' });
    await add({ email: 'ann@example.com' }, other);
    const html = (
      await app.inject({
        method: 'GET',
        url: `/orgs/${slug}/contacts/${personId('Ann')}`,
        headers: { cookie },
      })
    ).body;
    expect(html).toContain(
      'This person is also a contact of Other Ltd. A change here shows there too.',
    );
  });

  test('Remove deletes the membership, and the person when no other organisation has them', async () => {
    await add({ name: 'Ann', email: 'ann@example.com' });
    const other = await addOrg(app, cookie, { name: 'Other' });
    await add({ email: 'ann@example.com' }, other);
    const id = personId('Ann');

    const response = await postForm(
      app,
      `/orgs/${slug}/contacts/${id}/remove`,
      {},
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/acme');
    expect(contacts()).toEqual([
      expect.objectContaining({ name: 'Ann', slug: 'other' }),
    ]);

    await postForm(app, `/orgs/${other}/contacts/${id}/remove`, {}, cookie);
    expect(contacts()).toEqual([]);
    expect(
      db.query('SELECT count(*) AS n FROM person WHERE id = ?;').get(id),
    ).toEqual({ n: 0 });
    const deletes = db
      .query(
        "SELECT entity FROM audit_log WHERE action = 'delete' ORDER BY rowid;",
      )
      .all();
    expect(deletes).toEqual([
      { entity: 'membership' },
      { entity: 'membership' },
      { entity: 'person' },
    ]);
  });

  test('Remove never deletes the admin person', async () => {
    await add({ email: TEST_ADMIN_EMAIL });
    const id = (
      db
        .query('SELECT id FROM person WHERE email = ?;')
        .get(TEST_ADMIN_EMAIL) as {
        id: string;
      }
    ).id;
    await postForm(app, `/orgs/${slug}/contacts/${id}/remove`, {}, cookie);
    expect(contacts()).toEqual([]);
    expect(
      db.query('SELECT count(*) AS n FROM person WHERE id = ?;').get(id),
    ).toEqual({ n: 1 });
  });

  test('a person who is not a contact of this organisation returns 404', async () => {
    const stranger = addPerson(db, 'x@example.com');
    for (const [method, url] of [
      ['GET', `/orgs/${slug}/contacts/${stranger}`],
      ['POST', `/orgs/${slug}/contacts/${stranger}/remove`],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: method === 'POST' ? '' : undefined,
      });
      expect(response.statusCode).toBe(404);
    }
  });
});
