import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../../index';
import {
  addOrg,
  addPerson,
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

const add = (fields: Record<string, string>, to = slug) =>
  postForm(app, `/orgs/${to}/contacts`, fields, cookie);

/** The visible contacts: a removed contact has `hidden_at`. */
const contacts = () =>
  db
    .query(
      `SELECT person.name, person.phone, person.email, membership.role, organisation.slug
       FROM membership JOIN person ON person.id = membership.person_id
       JOIN organisation ON organisation.id = membership.organisation_id
       WHERE membership.hidden_at IS NULL
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
  test('adds a person and a membership as one event, with an audit row with no contact details', async () => {
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
    expect(lastEvent(db)).toEqual({
      kind: 'contact_add',
      person_id: personId('Ann Smith'),
      role: 'staff',
      fields: ['name', 'phone', 'email'],
      changes: [
        {
          table: 'membership',
          id: personId('Ann Smith'),
          before: { hidden: true },
          after: { hidden: false },
        },
      ],
    });
    const rows = db
      .query(
        "SELECT action, entity, detail FROM audit_log WHERE action LIKE 'contact%' ORDER BY rowid;",
      )
      .all() as { action: string; entity: string; detail: string }[];
    expect(rows.map((row) => `${row.action} ${row.entity}`)).toEqual([
      'contact_add organisation',
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

  test('the email of a removed contact returns 400 and names Restore', async () => {
    await add({ email: 'ann@example.com' });
    await postForm(app, `/orgs/${slug}/contacts/1/remove`, {}, cookie);
    const response = await add({ email: 'ann@example.com' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">A removed contact of this organisation has this email address. Tap Show hidden in Activity, then Restore.</p>',
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

describe('/orgs/<slug>/contacts/<number>', () => {
  test('GET shows the contact form of Add a contact, filled in', async () => {
    await add({ name: 'Ann', phone: '07700 900000', role: 'staff' });
    const html = (
      await app.inject({
        method: 'GET',
        url: `/orgs/${slug}/contacts/1`,
        headers: { cookie },
      })
    ).body;
    expect(html).toContain('<h2 class="label">Contact</h2>');
    expect(html).toContain('name="name" value="Ann"');
    expect(html).toContain('type="tel" name="phone" value="07700 900000"');
    expect(html).toContain('<option value="staff" selected="">Staff</option>');
  });

  test('POST saves the person and the role as one event, and the audit row names only the changed fields', async () => {
    await add({ name: 'Ann', phone: '07700 900000' });
    const response = await postForm(
      app,
      `/orgs/${slug}/contacts/1`,
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
    const id = personId('Ann Jones');
    expect(lastEvent(db)).toEqual({
      kind: 'contact_edit',
      person_id: id,
      fields: ['name', 'role'],
      changes: [
        {
          table: 'person',
          id,
          before: { name: 'Ann' },
          after: { name: 'Ann Jones' },
        },
        {
          table: 'membership',
          id,
          before: { role: 'owner' },
          after: { role: 'staff' },
        },
      ],
    });
    const rows = db
      .query(
        "SELECT detail FROM audit_log WHERE action = 'contact_edit' ORDER BY rowid;",
      )
      .all() as { detail: string }[];
    expect(rows.map((row) => JSON.parse(row.detail).fields)).toEqual([
      ['name', 'role'],
    ]);
    expect(rows.map((row) => row.detail).join()).not.toContain('Jones');
  });

  test('an email that another person has returns 400 and changes nothing', async () => {
    addPerson(db, 'taken@example.com');
    await add({ name: 'Ann' });
    const response = await postForm(
      app,
      `/orgs/${slug}/contacts/1`,
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
        url: `/orgs/${slug}/contacts/1`,
        headers: { cookie },
      })
    ).body;
    expect(html).toContain(
      'This person is also a contact of Other Ltd. A change here shows there too.',
    );
  });

  test('Remove hides the membership and deletes no row: the person stays, also the admin', async () => {
    await add({ name: 'Ann', email: 'ann@example.com' });
    const other = await addOrg(app, cookie, { name: 'Other' });
    await add({ email: 'ann@example.com' }, other);
    await add({ email: TEST_ADMIN_EMAIL });
    const id = personId('Ann');
    const rows = () =>
      db
        .query(
          'SELECT (SELECT count(*) FROM person) AS people, (SELECT count(*) FROM membership) AS members;',
        )
        .get();
    const before = rows();

    const response = await postForm(
      app,
      `/orgs/${slug}/contacts/1/remove`,
      {},
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs/acme');
    expect(contacts()).toEqual([
      expect.objectContaining({ email: TEST_ADMIN_EMAIL, slug: 'acme' }),
      expect.objectContaining({ name: 'Ann', slug: 'other' }),
    ]);
    await postForm(app, `/orgs/${other}/contacts/1/remove`, {}, cookie);
    await postForm(app, `/orgs/${slug}/contacts/2/remove`, {}, cookie);
    expect(contacts()).toEqual([]);
    expect(rows()).toEqual(before);
    expect(
      db
        .query(
          'SELECT hidden_by FROM membership WHERE person_id = ? AND organisation_id = (SELECT id FROM organisation WHERE slug = ?);',
        )
        .get(id, slug),
    ).toEqual({ hidden_by: 4 });
    expect(lastEvent(db)).toMatchObject({ kind: 'contact_remove' });
  });

  test('a number that the organisation does not have, a person id or a segment that is not a number returns 404', async () => {
    await add({ name: 'Ann' });
    const other = await addOrg(app, cookie, { name: 'Other' });
    for (const url of [
      `/orgs/${other}/contacts/1`,
      `/orgs/${slug}/contacts/2`,
      `/orgs/${slug}/contacts/${personId('Ann')}`,
      `/orgs/${slug}/contacts/0`,
      `/orgs/${slug}/contacts/01`,
      `/orgs/${slug}/contacts/1.0`,
    ]) {
      for (const [method, path] of [
        ['GET', url],
        ['POST', url],
        ['POST', `${url}/remove`],
      ] as const) {
        const response = await app.inject({
          method,
          url: path,
          headers: {
            cookie,
            'content-type': 'application/x-www-form-urlencoded',
          },
          payload: method === 'POST' ? 'name=Bob' : undefined,
        });
        expect(response.statusCode).toBe(404);
      }
    }
  });

  test('each organisation counts its contacts from 1, and a removed number is not used again (REQ-CRM-ID-001)', async () => {
    const numbers = (to: string) =>
      db
        .query(
          `SELECT person.name, membership.number FROM membership
           JOIN person ON person.id = membership.person_id
           JOIN organisation ON organisation.id = membership.organisation_id
           WHERE organisation.slug = ? AND membership.hidden_at IS NULL
           ORDER BY membership.number;`,
        )
        .all(to);
    await add({ name: 'Ann', email: 'ann@example.com' });
    await add({ name: 'Bob' });
    await postForm(app, `/orgs/${slug}/contacts/2/remove`, {}, cookie);
    await add({ name: 'Cat' });
    expect(numbers(slug)).toEqual([
      { name: 'Ann', number: 1 },
      { name: 'Cat', number: 3 },
    ]);
    // A person who is a contact of two organisations has a number in each.
    const other = await addOrg(app, cookie, {
      name: 'Other',
      contact_name: 'Dan',
    });
    await add({ email: 'ann@example.com' }, other);
    expect(numbers(other)).toEqual([
      { name: 'Dan', number: 1 },
      { name: 'Ann', number: 2 },
    ]);
    const page = await app.inject({
      method: 'GET',
      url: `/orgs/${other}/contacts/2`,
      headers: { cookie },
    });
    expect(page.body).toContain('name="email" value="ann@example.com"');
  });
});
