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
 * The rows of the Activity band, newest first. Each row is the text of its
 * cells: the event, the time, the text and Edit. The gutter (the month) is
 * left out.
 */
const activityRows = (html: string) => {
  const start = html.indexOf('aria-labelledby="activity"');
  const band = html.slice(start, html.indexOf('</section>', start));
  return [...band.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1).map((match) =>
    [
      ...match[1]
        .replace(/<th scope="rowgroup"[\s\S]*?<\/th>/, '')
        .matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g),
    ].map((cell) =>
      cell[1]
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  );
};

/**
 * Wait for the clock to move on, so that the next event has a later time
 * than the last one.
 */
const tick = () => Bun.sleep(3);

describe('GET /orgs/<slug>', () => {
  test('the glass shows the name, the next action, the stage, the last visit and the contact, and the last save is its first line', async () => {
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
    // The page is the rack over the bands, with no part of the old layout.
    expect(html).not.toContain('class="device');
    expect(html).not.toContain('class="body"');
    const glass = divOf(html, 'glass');
    expect(bodyText(`<body>${glass}`)).toMatch(
      /^Saved \d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d : Visit 1\. Name Acme Plumbing 1 High Street, SW1A 1AA Next action Chase quote 2000-Jan-01 · \d+ days overdue Stage Quoted Last visit \d{4}-[A-Z][a-z]{2}-\d\d Visit 1 · Spoke Contact Ann Smith Owner · 07700 900000$/,
    );
    // The name is the one large value. Overdue has the mark.
    expect(glass).toContain(
      '<div class="name"><dt>Name</dt><dd class="value">Acme Plumbing</dd>',
    );
    expect(glass.match(/class="line mark"/g)).toHaveLength(1);
  });

  test('with no data, each value says None, No contacts or No visits, and the glass keeps its lines', async () => {
    const other = await addOrg(app, cookie, { name: 'Zed' });
    const html = (await get(`/orgs/${other}`)).body;
    expect(bodyText(`<body>${divOf(html, 'glass')}`)).toMatch(
      /^Saved \S+ \S+ : Added\. Name Zed No address Next action None No due date Stage Lead Last visit None No visits Contact No contacts None$/,
    );
  });

  test('the control unit has Log, Stage and Next action in one row, with the sub-labels', async () => {
    await addOrg(app, cookie, { name: 'Other' });
    await post(`/orgs/${slug}/stage`, { stage: 'quoted' });
    const html = (await get(`/orgs/${slug}`)).body;
    const controls = divOf(html, 'modules');
    const modules = [
      ...controls.matchAll(
        /<section id="(\w+)" class="module span-(\d+)[^"]*"><h2 class="label">([^<]+)<\/h2>/g,
      ),
    ].map((match) => [match[1], Number(match[2]), match[3]]);
    expect(modules).toEqual([
      ['log', 5, 'Log'],
      ['stage', 3, 'Stage'],
      ['next', 4, 'Next action'],
    ]);
    expect(html).not.toContain('class="help"');
    // Log: the field, then the Save as visit keys in rows of 3, 2 and 1.
    expect(controls).toContain(
      '<span class="label">Visit note</span> <textarea name="note" placeholder="What happened today?" rows="2"></textarea>',
    );
    expect(controls).toContain('<legend class="label">Save as visit</legend>');
    const rows = [...controls.matchAll(/<div class="keys">([\s\S]*?)<\/div>/g)]
      .map((match) => bodyText(`<body>${match[1]}`))
      .slice(0, 3);
    expect(rows).toEqual([
      'No answer Spoke Call back then due',
      'Not interested Do not knock sets Lost',
      'Note only no visit',
    ]);
    expect(controls).toContain(
      '<form action="/orgs/acme-plumbing/activity" method="post">',
    );
    // Each stage key shows its count.
    expect(bodyText(`<body>${divOf(controls, 'keys grid')}`)).toBe(
      'Lead 1 Visited 0 Follow-up 0 Quoted (current) 1 Won 0 Lost 0',
    );
    // Each due key prints the date that it sets, and Clear is in its place.
    const due = bodyText(
      `<body>${controls.slice(controls.indexOf('<legend class="label">Set due'))}`,
    );
    expect(due).toMatch(
      /^Set due Tomorrow \d{4}-[A-Z][a-z]{2}-\d\d \+3 days \d{4}-[A-Z][a-z]{2}-\d\d \+1 week \d{4}-[A-Z][a-z]{2}-\d\d Clear/,
    );
  });

  test('a due key sets the date that it prints, and Clear clears the next action', async () => {
    const html = (await get(`/orgs/${slug}`)).body;
    const tomorrow = html.match(/value="([\d-]+)" name="due">Tomorrow/)?.[1];
    expect(tomorrow).toMatch(/^\d{4}-\d\d-\d\d$/);
    await post(`/orgs/${slug}/stage`, {
      stage: 'lead',
      next_action: 'Call',
      next_action_on: '',
      due: String(tomorrow),
    });
    const pipeline = () =>
      db.query('SELECT next_action, next_action_on FROM organisation;').get();
    expect(pipeline()).toEqual({
      next_action: 'Call',
      next_action_on: tomorrow,
    });
    expect((await get(`/orgs/${slug}`)).body).toContain(
      `aria-pressed="true" value="${tomorrow}" name="due">Tomorrow`,
    );
    // Clear posts an empty next action and date.
    await post(`/orgs/${slug}/stage`, {
      stage: 'lead',
      next_action: '',
      next_action_on: '',
    });
    expect(pipeline()).toEqual({ next_action: null, next_action_on: null });
    expect((await get(`/orgs/${slug}`)).body).toContain(
      'id="clear-next" disabled="" title="No next action to clear."',
    );
  });

  test('an overdue next action shows in three places: the mark in the glass, the Next action module and the due keys', async () => {
    await post(`/orgs/${slug}/stage`, {
      stage: 'lead',
      next_action: 'Call',
      next_action_on: '2000-01-01',
    });
    const html = (await get(`/orgs/${slug}`)).body;
    expect(divOf(html, 'glass')).toContain('class="line mark"');
    expect(html).toContain(
      '<section id="next" class="module span-4 problem"><h2 class="label">Next action</h2><p class="value">Overdue</p>',
    );
    expect(html.match(/class="key latch fix"[^>]*name="due"/g)).toHaveLength(3);
  });

  test('Undo and Redo are on the plate, and each caption names the change', async () => {
    await post(`/orgs/${slug}/activity`, { outcome: 'spoke', note: '' });
    let plate = divOf(
      divOf((await get(`/orgs/${slug}`)).body, 'plate'),
      'plate-row',
    );
    expect(bodyText(`<body>${plate}`).replace(/ Prev .*$/, '')).toBe(
      'Undo Undo: Visit 1 Redo Nothing to redo. A new change clears the redo list.',
    );
    const event = plate.match(/name="event" value="(\d+)"/)?.[1] ?? '';
    await post(`/orgs/${slug}/undo`, { event });
    plate = divOf(
      divOf((await get(`/orgs/${slug}`)).body, 'plate'),
      'plate-row',
    );
    expect(bodyText(`<body>${plate}`).replace(/ Prev .*$/, '')).toBe(
      'Undo Nothing to undo. Redo Redo: Visit 1',
    );
  });

  test('Activity is open, one row for each event, newest first, grouped by month', async () => {
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
    expect(html).not.toContain('<details');
    // One month: its name and its count are in the gutter.
    expect(html).toMatch(
      /<th scope="rowgroup" rowSpan="5" class="c-gutter"><span class="group">\d{4}-[A-Z][a-z]{2}<\/span> <span class="count">5<\/span><\/th>/,
    );
    expect(bodyText(html)).toContain('Activity 5 events, newest first.');
    const rows = activityRows(html);
    for (const row of rows) {
      expect(row[1]).toMatch(/^\d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d$/);
    }
    expect(rows.map(([event, , text, edit]) => [event, text, edit])).toEqual([
      ['Visit 3 · Spoke', 'No note.', 'Edit'],
      ['Stage', 'Stage: Lead → Visited.', ''],
      ['Note 2', 'A note', 'Edit'],
      ['Visit 1 · No answer', 'First visit', 'Edit'],
      ['Added', 'At the stage Lead. Contact added: Ann Smith (Owner).', ''],
    ]);
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

    const lines = activityRows((await get(`/orgs/${slug}`)).body).map(
      (row) => row[2],
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^Visit 1 of \d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d: saved as Call back\.$/,
      ),
    );
    // A removed contact stays in the crm, hidden, so its name shows.
    expect(lines).toContain('Contact removed: Bob.');
    expect(lines).toContain('Contact added: Bob (Staff).');
    expect(lines).toContain('Contact changed: Ann Jones (Name, Role).');
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

  test('Contacts: each one has phone and email links, Edit and Remove, and the last row adds a contact', async () => {
    const html = (await get(`/orgs/${slug}`)).body;
    expect(html).toContain(
      '<th scope="row" class="c-name" title="Ann Smith"><span class="arrow" aria-hidden="true"></span>Ann Smith</th>',
    );
    expect(html).toContain('<a href="tel:07700 900000">07700 900000</a>');
    expect(html).toContain(
      '<a href="mailto:ann@example.com">ann@example.com</a>',
    );
    expect(html).toContain(
      '<a href="/orgs/acme-plumbing/contacts/1">Edit</a> <form action="/orgs/acme-plumbing/contacts/1/remove" method="post"><button type="submit" class="link">Remove</button></form>',
    );
    // The last row: the contact form, each field under its column, and
    // the key. A table row cannot hold a form, so the form is in the head
    // of the band, and each control names it.
    expect(html).toContain(
      '<form id="add-contact" action="/orgs/acme-plumbing/contacts" method="post"></form>',
    );
    const foot = html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'));
    expect(
      [...foot.matchAll(/<td class="(c-\w+)">/g)].map((match) => match[1]),
    ).toEqual(['c-name', 'c-phone', 'c-email', 'c-role', 'c-act']);
    expect(foot.match(/ form="add-contact"/g)).toHaveLength(5);
    expect(foot).toContain(
      '<button type="submit" class="key" form="add-contact">Add contact</button>',
    );
  });

  test('with no contacts, Contacts says No contacts, and the last row still adds one', async () => {
    const other = await addOrg(app, cookie, { name: 'Zed' });
    const html = (await get(`/orgs/${other}`)).body;
    expect(html).toContain('<td colSpan="5" class="empty">No contacts.</td>');
    expect(html).toContain('<form id="add-contact"');
    expect(html).toContain('>Add contact</button>');
  });

  test('Details has the address, the source, the lawful basis, the date added and Edit, and None for an empty value', async () => {
    const html = (await get(`/orgs/${slug}`)).body;
    expect(bodyText(html)).toMatch(
      /Details Edit Address 1 High Street, SW1A 1AA Source door Lawful basis legitimate interests Added \d{4}-[A-Z][a-z]{2}-\d\d \d\d:\d\d/,
    );
    expect(html).toContain(
      '<div class="tools"><a href="/orgs/acme-plumbing/edit">Edit</a></div>',
    );
    const other = await addOrg(app, cookie, { name: 'Zed' });
    expect(bodyText((await get(`/orgs/${other}`)).body)).toContain(
      'Address None Source None',
    );
  });

  test('a problem shows in three places: the glass, the part with a thick outline and a word, and the key that fixes it', async () => {
    // Log: Note only with no note.
    const log = (await post(`/orgs/${slug}/activity`, { outcome: 'note' }))
      .body;
    expect(log).toContain(
      '<p role="alert" class="status"><span>Type a visit note, then tap Note only.</span></p>',
    );
    expect(log).toContain(
      '<label class="field problem"><span class="label">Visit note<strong class="problem-word"> · needed</strong></span> <textarea name="note" placeholder="What happened today?" aria-invalid="true" rows="2"></textarea>',
    );
    expect(log).toContain(
      '<button type="submit" class="key fix" value="note" name="outcome">Note only',
    );
    // Add contact: an email that is not valid. The row keeps the values.
    const contact = (
      await post(`/orgs/${slug}/contacts`, {
        name: 'Bob',
        email: 'bob',
        role: 'staff',
      })
    ).body;
    expect(contact).toContain(
      '<p role="alert" class="status"><span>The email address is not valid.</span></p>',
    );
    expect(contact).toContain(
      '<span class="label">Email<strong class="problem-word"> · not valid</strong></span>',
    );
    expect(contact).toContain('name="email" value="bob"');
    expect(contact).toContain(
      '<button type="submit" class="key fix" form="add-contact">Add contact</button>',
    );
    // Next action: a date that is not valid.
    const next = (
      await post(`/orgs/${slug}/stage`, {
        stage: 'lead',
        next_action_on: 'soon',
      })
    ).body;
    expect(next).toContain('<span>The Due date is not valid.</span>');
    expect(next).toContain('<section id="next" class="module span-4 problem">');
    expect(next).toContain('Due date<strong class="problem-word"> · not valid');
    expect(next).toContain(
      '<button type="submit" class="key fix">Save</button>',
    );
    // No state uses colour alone: with no page styles, the word is text.
    const bare = bodyText(log);
    expect(bare).toContain('Visit note · needed');
  });

  test('the edit pages mark the field with the problem', async () => {
    const edit = (await post(`/orgs/${slug}/edit`, { name: '', slug })).body;
    expect(edit).toContain('<span>Type the name of the organisation.</span>');
    expect(edit).toContain(
      '<span class="label">Name<strong class="problem-word"> · needed</strong></span>',
    );
    const contact = (
      await post(`/orgs/${slug}/contacts/1`, { name: '', role: 'owner' })
    ).body;
    expect(contact).toContain(
      '<span>Type a name, a phone number or an email address.</span>',
    );
    expect(contact).toContain(
      '<span class="label">Name<strong class="problem-word"> · needed</strong></span>',
    );
    // The glass reads the contact as it is saved.
    expect(bodyText(`<body>${divOf(contact, 'glass')}`)).toContain(
      'Contact 1 Ann Smith Acme Plumbing Role Owner Phone 07700 900000 Email ann@example.com',
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
