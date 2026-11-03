import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../../index';
import {
  addOrg,
  bodyText,
  divOf,
  postForm,
  signInAdmin,
  testApp,
} from '../../test-helpers';

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
    contact_name: 'Ann Smith',
    contact_phone: '07700 900000',
    contact_email: 'ann@example.com',
    source: 'door',
  });
});

afterEach(async () => {
  await close();
});

const get = (url: string, headers: Record<string, string> = { cookie }) =>
  app.inject({ method: 'GET', url, headers });

const post = (url: string, fields: Record<string, string>) =>
  postForm(app, url, fields, cookie);

/**
 * The lines of the Activity list, as text, newest first. Each line starts
 * with its time.
 */
const activityLines = (html: string) =>
  [...html.matchAll(/<li><time[\s\S]*?<\/li>/g)].map((match) =>
    match[0]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );

/**
 * Wait for the clock to move on, so that the next event has a later time
 * than the last one.
 */
const tick = () => Bun.sleep(3);

describe('GET /orgs/<slug>', () => {
  test('the LCD shows the name, the stage, the next action and the last visit', async () => {
    await post(`/orgs/${slug}/stage`, {
      stage: 'quoted',
      next_action: 'Chase quote',
      next_action_on: '2000-01-01',
    });
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: '' });
    const response = await get(`/orgs/${slug}`);
    expect(response.statusCode).toBe(200);
    const html = response.body;
    expect(html).toContain('<title>Acme Plumbing - crm</title>');
    expect(html).toContain(
      '<a href="/orgs">orgs</a> / <span class="here" aria-current="page">acme-plumbing</span>',
    );
    const lcd = bodyText(divOf(html, 'lcd'));
    expect(lcd).toContain('Name Acme Plumbing Stage Quoted');
    expect(lcd).toContain('Next action Chase quote Due 2000-Jan-01 ·');
    expect(lcd).toMatch(/Last visit \d{4}-[A-Z][a-z]{2}-\d\d · Spoke$/);
  });

  test('the device has Log, Stage, Next action and Add a contact, in that order, and no help text', async () => {
    const html = (await get(`/orgs/${slug}`)).body;
    const device = divOf(html, 'device');
    const labels = [...device.matchAll(/<h2 class="label">([^<]+)<\/h2>/g)].map(
      (match) => match[1],
    );
    expect(labels).toEqual(['Log', 'Stage', 'Next action', 'Add a contact']);
    expect(html).not.toContain('class="help"');
    // Log: the field, then the Save as buttons in rows of 3, 2 and 1.
    expect(device).toContain(
      '<span class="label">Visit note</span> <textarea name="note" placeholder="What happened today?" rows="2"></textarea>',
    );
    const rows = [...device.matchAll(/<div class="keys">([\s\S]*?)<\/div>/g)]
      .map((match) => bodyText(`<body>${match[1]}`))
      .slice(0, 3);
    expect(rows).toEqual([
      'No answer Spoke Call back',
      'Not interested Do not knock',
      'Note only',
    ]);
    expect(device).toContain(
      '<form action="/orgs/acme-plumbing/activity" method="post">',
    );
    expect(device).toContain(
      '<form action="/orgs/acme-plumbing/contacts" method="post">',
    );
  });

  test('Activity is one list of every event, newest first, in a closed <details>', async () => {
    await tick();
    await post(`/orgs/${slug}/activity`, {
      outcome: 'no_answer',
      note: 'First visit',
    });
    await tick();
    await post(`/orgs/${slug}/activity`, { outcome: 'note', note: 'A note' });
    await tick();
    await post(`/orgs/${slug}/stage`, { stage: 'visited' });
    await tick();
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: '' });
    const html = (await get(`/orgs/${slug}`)).body;
    expect(html).toContain('<details class="events"><summary>');
    expect(html).not.toContain('<details class="events" open');
    const summary = bodyText(
      `<body>${html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'))}`,
    );
    expect(summary).toMatch(/^6 events\. Newest: \S+ \S+ Visit 3: Spoke\.$/);
    const lines = activityLines(html);
    expect(lines.map((line) => line.slice(18))).toEqual([
      'Visit 3: Spoke. Edit',
      'Stage: Lead → Visited.',
      'Note 2: A note Edit',
      'Visit 1: No answer. First visit Edit',
      'Contact added: Ann Smith (Owner).',
      'Added at the stage Lead.',
    ]);
    // A visit with no note shows no word in place of the note.
    expect(divOf(html, 'data-col')).not.toContain('None');
  });

  test('each change shows in Activity, with the names from the current tables', async () => {
    await post(`/orgs/${slug}/stage`, {
      stage: 'lead',
      next_action: 'Call',
      next_action_on: '2030-01-02',
    });
    await post(`/orgs/${slug}/stage`, { stage: 'lead' });
    await post(`/orgs/${slug}/edit`, {
      name: 'Acme Plumbing',
      source: 'web',
      slug,
      postcode: 'E1 6AN',
    });
    await post(`/orgs/${slug}/contacts/1`, {
      name: 'Ann Jones',
      phone: '07700 900000',
      email: 'ann@example.com',
      role: 'staff',
    });
    await post(`/orgs/${slug}/contacts`, { name: 'Bob', role: 'staff' });
    await post(`/orgs/${slug}/contacts/2/remove`, {});
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: 'Hi' });
    await post(`/orgs/${slug}/activity/1`, {
      outcome: 'call_back',
      note: 'Hi',
    });

    const lines = activityLines((await get(`/orgs/${slug}`)).body).map((line) =>
      line.slice(18),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^Visit 1 of \d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d: saved as Call back\.$/,
      ),
    );
    expect(lines).toContain('Contact removed.');
    expect(lines).toContain('Contact added: a removed contact (Staff).');
    expect(lines).toContain('Contact changed: Ann Jones (Role).');
    expect(lines).toContain('Contact changed: Ann Jones (Name).');
    expect(lines).toContain(
      'Details changed: Source, Address line 1, Postcode.',
    );
    expect(lines).toContain('Next action cleared.');
    expect(lines).toContain('Next action due 2030-Jan-02.');
  });

  test('no write copies personal data or text into audit_log', async () => {
    await post(`/orgs/${slug}/stage`, {
      stage: 'quoted',
      next_action: 'Secret plan',
      next_action_on: '2030-01-02',
    });
    await post(`/orgs/${slug}/activity`, {
      outcome: 'spoke',
      note: 'Secret visit',
    });
    await post(`/orgs/${slug}/activity`, {
      outcome: 'note',
      note: 'Secret note',
    });
    await post(`/orgs/${slug}/activity/2`, {
      outcome: 'note',
      note: 'Secret change',
    });
    await post(`/orgs/${slug}/edit`, {
      name: 'Acme Plumbing',
      slug,
      address_line_1: '9 Secret Road',
    });
    await post(`/orgs/${slug}/contacts/1`, {
      name: 'Ann Secret',
      phone: '07700 999999',
      email: 'secret@example.com',
      role: 'owner',
    });
    await post(`/orgs/${slug}/contacts`, {
      name: 'Bob Secret',
      phone: '07700 888888',
      email: 'bob@example.com',
      role: 'staff',
    });
    await post(`/orgs/${slug}/contacts/2/remove`, {});

    const details = (
      db.query('SELECT detail FROM audit_log;').all() as {
        detail: string | null;
      }[]
    )
      .map((row) => row.detail ?? '')
      .join('\n');
    for (const secret of [
      'Secret',
      'Ann',
      '07700',
      'example.com',
      '1 High Street',
      'SW1A',
    ]) {
      expect(details).not.toContain(secret);
    }
  });

  test('Contacts: each one has phone and email links, Edit and Remove', async () => {
    const html = (await get(`/orgs/${slug}`)).body;
    expect(html).toContain('<th scope="row">Ann Smith</th>');
    expect(html).toContain('<a href="tel:07700 900000">07700 900000</a>');
    expect(html).toContain(
      '<a href="mailto:ann@example.com">ann@example.com</a>',
    );
    expect(html).toContain(
      '<a href="/orgs/acme-plumbing/contacts/1">Edit</a> <form action="/orgs/acme-plumbing/contacts/1/remove" method="post"><button type="submit" class="link">Remove</button></form>',
    );
  });

  test('with no contacts, Contacts says so and links Add a contact', async () => {
    const other = await addOrg(app, cookie, { name: 'Zed' });
    const html = (await get(`/orgs/${other}`)).body;
    expect(html).toContain(
      '<p>No contacts. <a href="#add-contact">Add a contact</a>.</p>',
    );
    expect(html).toContain('<section id="add-contact" class="module">');
  });

  test('Details has the address, the source, the lawful basis, the date added and Edit', async () => {
    const text = bodyText((await get(`/orgs/${slug}`)).body);
    expect(text).toMatch(
      /Details Address 1 High Street, SW1A 1AA Source door Lawful basis legitimate interests Added \d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d Edit/,
    );
    expect((await get(`/orgs/${slug}`)).body).toContain(
      '<p class="row-actions"><a href="/orgs/acme-plumbing/edit">Edit</a></p>',
    );
  });

  test('a slug that does not exist returns 404', async () => {
    const response = await get('/orgs/no-such-org');
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('<title>Not found - crm</title>');
    expect(response.body).toContain('No page has this address.');
    // The old address at the root is not an organisation page.
    expect((await get(`/${slug}`)).statusCode).toBe(404);
  });

  test('/orgs/new wins over /orgs/<slug>, and the path title links each part', async () => {
    expect((await get('/orgs/new')).body).toContain(
      '<title>New lead - crm</title>',
    );
    for (const part of ['activity', 'contacts']) {
      const response = await get(`/orgs/${slug}/${part}`);
      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe('/orgs/acme-plumbing');
    }
  });

  test('a signed-out visitor goes to the sign-in page, and returns to the organisation after', async () => {
    const response = await get(`/orgs/${slug}`, {});
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      '/login?next=%2Forgs%2Facme-plumbing',
    );
  });
});
