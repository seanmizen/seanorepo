import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../index';
import { addOrg, postForm, signInAdmin, testApp } from '../test-helpers';

let app: ReturnType<typeof buildApp>;
let close: () => Promise<void>;
let cookie: string;
let slug: string;

beforeEach(async () => {
  ({ app, close } = testApp());
  cookie = signInAdmin(app);
  slug = await addOrg(app, cookie, {
    name: 'Acme Plumbing',
    address_line_1: '1 High Street',
    postcode: 'SW1A 1AA',
    contact_name: 'Ann Smith',
    phone: '07700 900000',
    email: 'ann@example.com',
    source: 'door',
  });
});

afterEach(async () => {
  await close();
});

const get = (url: string, headers: Record<string, string> = { cookie }) =>
  app.inject({ method: 'GET', url, headers });

describe('GET /<slug>', () => {
  test('shows the details, the contacts and the forms', async () => {
    const response = await get(`/${slug}`);
    expect(response.statusCode).toBe(200);
    const html = response.body;
    expect(html).toContain('<h1>Acme Plumbing</h1>');
    expect(html).toContain('<dt>Stage</dt><dd>Lead</dd>');
    expect(html).toContain('<dd>1 High Street, SW1A 1AA</dd>');
    expect(html).toContain('<dd>legitimate interests</dd>');
    expect(html).toContain('<th scope="row">Ann Smith</th>');
    expect(html).toContain('<a href="tel:07700 900000">07700 900000</a>');
    expect(html).toContain(
      '<a href="mailto:ann@example.com">ann@example.com</a>',
    );
    expect(html).toContain(
      '<form action="/acme-plumbing/visits" method="post">',
    );
    expect(html).toContain(
      '<form action="/acme-plumbing/stage" method="post">',
    );
    expect(html).toContain(
      '<form action="/acme-plumbing/notes" method="post">',
    );
    expect(html).toContain('No visits.');
    expect(html).toContain('No notes.');
  });

  test('shows the visits and the notes newest first', async () => {
    await postForm(
      app,
      `/${slug}/visits`,
      { outcome: 'no_answer', note: 'First visit' },
      cookie,
    );
    await postForm(
      app,
      `/${slug}/visits`,
      { outcome: 'spoke', note: 'Second visit' },
      cookie,
    );
    await postForm(app, `/${slug}/notes`, { body: 'First note' }, cookie);
    await postForm(app, `/${slug}/notes`, { body: 'Second note' }, cookie);
    const html = (await get(`/${slug}`)).body;
    expect(html.indexOf('Second visit')).toBeLessThan(
      html.indexOf('First visit'),
    );
    expect(html.indexOf('Second note')).toBeLessThan(
      html.indexOf('First note'),
    );
    expect(html).toContain('<td>Spoke</td><td>Second visit</td>');
  });

  test('a slug that does not exist returns 404', async () => {
    const response = await get('/no-such-org');
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('<h1>Not found</h1>');
  });

  test('the pages with fixed paths win over the slug route', async () => {
    expect((await get('/orgs')).body).toContain('<h1>Organisations</h1>');
    expect((await get('/login')).statusCode).toBe(200);
    expect((await get('/api/health')).body).toBe('{"ok":true}');
    expect((await get('/account/sessions')).body).toContain(
      '<h1>Sessions</h1>',
    );
  });

  test('a signed-out visitor goes to the sign-in page, and returns to the organisation after', async () => {
    const response = await get(`/${slug}`, {});
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/login?next=%2Facme-plumbing');
  });
});
