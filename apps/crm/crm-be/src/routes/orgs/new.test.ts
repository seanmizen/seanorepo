import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../index';
import {
  addOrg,
  addPerson,
  postForm,
  signInAdmin,
  TEST_ADMIN_EMAIL,
  testApp,
} from '../../test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let cookie: string;
let actor: string;

beforeEach(() => {
  ({ app, db, close } = testApp());
  cookie = signInAdmin(app);
  actor = (
    db
      .query('SELECT id FROM person WHERE email = ?;')
      .get(TEST_ADMIN_EMAIL) as {
      id: string;
    }
  ).id;
});

afterEach(async () => {
  await close();
});

const count = (table: string) =>
  (db.query(`SELECT count(*) AS n FROM ${table};`).get() as { n: number }).n;

const auditRows = () =>
  db
    .query(
      'SELECT actor, action, entity FROM audit_log WHERE action != ? ORDER BY rowid;',
    )
    .all('sign_in');

describe('GET /orgs/new', () => {
  test('shows the new-lead form with each field', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/orgs/new',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const html = response.body;
    expect(html).toContain('<form action="/orgs/new" method="post">');
    for (const name of [
      'name',
      'address_line_1',
      'address_line_2',
      'postcode',
      'contact_name',
      'phone',
      'email',
      'source',
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
  });
});

describe('POST /orgs/new', () => {
  test('adds the organisation, its contact and the owner membership, then goes to its page', async () => {
    const response = await postForm(
      app,
      '/orgs/new',
      {
        name: 'Acme Plumbing',
        address_line_1: '1 High Street',
        postcode: 'sw1a 1aa',
        contact_name: 'Ann Smith',
        phone: '07700 900000',
        email: 'Ann@Example.com',
        source: 'door',
      },
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/acme-plumbing');

    expect(db.query('SELECT * FROM organisation;').get()).toMatchObject({
      slug: 'acme-plumbing',
      name: 'Acme Plumbing',
      address_line_1: '1 High Street',
      address_line_2: null,
      postcode: 'SW1A 1AA',
      stage: 'lead',
      lawful_basis: 'legitimate_interests',
      source: 'door',
    });
    expect(
      db
        .query('SELECT name, email, phone FROM person WHERE email = ?;')
        .get('ann@example.com'),
    ).toEqual({
      name: 'Ann Smith',
      email: 'ann@example.com',
      phone: '07700 900000',
    });
    expect(db.query('SELECT role FROM membership;').all()).toEqual([
      { role: 'owner' },
    ]);

    expect(auditRows()).toEqual([
      { actor, action: 'create', entity: 'organisation' },
      { actor, action: 'create', entity: 'person' },
      { actor, action: 'create', entity: 'membership' },
    ]);
  });

  test('links the person that has the email, and adds no person', async () => {
    const existing = addPerson(db, 'ann@example.com');
    const people = count('person');
    await addOrg(app, cookie, { name: 'Acme', email: 'ANN@example.com' });
    expect(count('person')).toBe(people);
    expect(db.query('SELECT person_id FROM membership;').get()).toEqual({
      person_id: existing,
    });
  });

  test('with no contact fields, adds no person and no membership', async () => {
    const people = count('person');
    await addOrg(app, cookie, { name: 'Acme' });
    expect(count('person')).toBe(people);
    expect(count('membership')).toBe(0);
  });

  test('a contact with no email is allowed, and two contacts with no email do not clash', async () => {
    await addOrg(app, cookie, { name: 'A', contact_name: 'Ann' });
    await addOrg(app, cookie, { name: 'B', phone: '07700 900001' });
    expect(count('membership')).toBe(2);
  });

  test('keeps each slug unique, and never makes a reserved word', async () => {
    expect(await addOrg(app, cookie, { name: 'Acme' })).toBe('acme');
    expect(await addOrg(app, cookie, { name: 'ACME!' })).toBe('acme-2');
    expect(await addOrg(app, cookie, { name: 'Orgs' })).toBe('orgs-2');
    // /orgs is still the list.
    const list = await app.inject({
      method: 'GET',
      url: '/orgs',
      headers: { cookie },
    });
    expect(list.body).toContain('<title>Organisations - crm</title>');
  });

  test('with no name, shows the form again with the error and the values, and adds nothing', async () => {
    const response = await postForm(
      app,
      '/orgs/new',
      { name: '  ', postcode: 'E1 6AN' },
      cookie,
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(
      '<p role="alert">Type the name of the organisation.</p>',
    );
    expect(response.body).toContain('value="E1 6AN"');
    expect(count('organisation')).toBe(0);
  });

  test('with an email that is not valid, adds nothing', async () => {
    const response = await postForm(
      app,
      '/orgs/new',
      { name: 'Acme', email: 'not an email' },
      cookie,
    );
    expect(response.statusCode).toBe(400);
    expect(count('organisation')).toBe(0);
  });

  test('a signed-out POST adds nothing', async () => {
    const response = await postForm(app, '/orgs/new', { name: 'Acme' });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/login');
    expect(count('organisation')).toBe(0);
  });
});
