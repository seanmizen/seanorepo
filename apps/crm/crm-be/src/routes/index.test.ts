import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatDate, today } from '../dates';
import type { buildApp } from '../index';
import { nextNumber } from '../org';
import { FE_DIST } from '../render';
import {
  addOrg,
  bodyText,
  divOf,
  postForm,
  signInAdmin,
  testApp,
} from '../test-helpers';
import { LIST_PATHS, nextSort, PAGE_SIZE } from './index';

/** The start of a GET form of the list at `/`. */
const LIST_FORM = `<form action="/" method="get">`;

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let cookie: string;

beforeEach(() => {
  ({ app, db, close } = testApp());
  cookie = signInAdmin(app);
});

afterEach(async () => {
  await close();
});

/** GET `url` as the signed-in person, or signed out with `{}`. */
const get = (url: string, headers: Record<string, string> = { cookie }) =>
  app.inject({ method: 'GET', url, headers });

/** The date `days` from today, as `YYYY-MM-DD`. */
const dayFromToday = (days: number) => {
  const date = new Date(`${today()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Add an organisation with a next action on `date`. Returns its slug. */
const addDue = async (name: string, date: string, nextAction = 'Call') => {
  const slug = await addOrg(app, cookie, { name });
  await postForm(
    app,
    `/orgs/${slug}/stage`,
    { stage: 'lead', next_action: nextAction, next_action_on: date },
    cookie,
  );
  return slug;
};

/** Add an organisation with a contact, a next action, a visit and a note. */
const addFullOrg = async () => {
  const slug = await addOrg(app, cookie, {
    name: 'Acme Plumbing',
    postcode: 'SW1A 1AA',
    contact_name: 'Ann Smith',
    contact_phone: '07700 900000',
    contact_email: 'ann@example.com',
    source: 'door',
  });
  await postForm(
    app,
    `/orgs/${slug}/stage`,
    {
      stage: 'quoted',
      next_action: 'Chase quote',
      next_action_on: '2000-01-01',
    },
    cookie,
  );
  await postForm(
    app,
    `/orgs/${slug}/activity`,
    { outcome: 'spoke', note: 'Wants a site' },
    cookie,
  );
  await postForm(
    app,
    `/orgs/${slug}/activity`,
    { outcome: 'note', note: 'Owner is Ann' },
    cookie,
  );
  return slug;
};

/**
 * The edit pages that the organisation page links: the organisation, the
 * first contact and the first visit or note.
 */
const editPages = (orgHtml: string) => {
  const link = (pattern: RegExp) => {
    const match = orgHtml.match(pattern);
    if (!match) throw new Error(`No link matches ${pattern}.`);
    return match[0];
  };
  return [
    link(/\/orgs\/[a-z0-9-]+\/edit(?=")/),
    link(/\/orgs\/[a-z0-9-]+\/contacts\/[0-9a-f-]+(?=")/),
    link(/\/orgs\/[a-z0-9-]+\/activity\/[0-9a-f-]+(?=")/),
  ];
};

/** The names in the band, in order. */
const names = async (url: string) => {
  const response = await get(url);
  expect(response.statusCode).toBe(200);
  return [
    ...response.body.matchAll(
      /<th scope="row" class="c-name" title="[^"]*"><a href="\/orgs\/[^"]+"><span class="arrow" aria-hidden="true"><\/span>([^<]+)<\/a><\/th>/g,
    ),
  ].map((m) => m[1]);
};

/** The gutter of the band: the name and the count of each group. */
const gutterOf = (html: string) =>
  [
    ...html.matchAll(
      /<span class="group">([^<]+)<\/span> <span class="count">(\d+)<\/span>/g,
    ),
  ].map((m) => `${m[1]} ${m[2]}`);

/** The band of a page: its `<section>`. */
const bandOf = (html: string) => {
  const start = html.indexOf('<section class="band"');
  return start === -1 ? '' : html.slice(start, html.indexOf('</table>', start));
};

/** The row of the organisation `slug` in the band. */
const rowOf = (html: string, slug: string) => {
  const link = html.indexOf(`<a href="/orgs/${slug}">`);
  const start = html.lastIndexOf('<tr>', link);
  return html.slice(start, html.indexOf('</tr>', link) + '</tr>'.length);
};

/** Set the added time of an organisation. */
const setAdded = (slug: string, at: string) =>
  db
    .query('UPDATE organisation SET created_at = ? WHERE slug = ?;')
    .run(at, slug);

/** The id of an organisation. */
const idOf = (slug: string) =>
  db
    .query<{ id: string }, [string]>(
      'SELECT id FROM organisation WHERE slug = ?;',
    )
    .get(slug)?.id;

/** Add a visit to an organisation at the time `at`. */
const addVisit = (slug: string, at: string) => {
  const orgId = idOf(slug) ?? '';
  db.query(
    `INSERT INTO visit (id, organisation_id, number, at, outcome) VALUES (?, ?, ?, ?, 'spoke');`,
  ).run(crypto.randomUUID(), orgId, nextNumber(db, orgId, 'activity'), at);
};

/** Add a note to an organisation at the time `at`. */
const addNote = (slug: string, at: string) => {
  const orgId = idOf(slug) ?? '';
  db.query(
    `INSERT INTO note (id, organisation_id, number, body, created_at) VALUES (?, ?, ?, 'A note', ?);`,
  ).run(crypto.randomUUID(), orgId, nextNumber(db, orgId, 'activity'), at);
};

/**
 * Three organisations with known times, and no next action:
 * - Bravo: added first, with a visit last.
 * - Alpha: added second, with a note.
 * - Charlie: added last, with no visit or note.
 */
const addThree = async () => {
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    await addOrg(app, cookie, { name });
  }
  setAdded('bravo', '2026-01-01T10:00:00.000Z');
  setAdded('alpha', '2026-02-01T10:00:00.000Z');
  setAdded('charlie', '2026-03-01T10:00:00.000Z');
  addNote('alpha', '2026-03-15T10:00:00.000Z');
  addVisit('bravo', '2026-04-01T10:00:00.000Z');
};

describe('GET / and GET /orgs', () => {
  test('renders the list in the page anatomy, with the assets', async () => {
    const response = await get('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');

    const html = response.body;
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toContain('<title>Organisations - crm</title>');
    expect(html).toContain(
      '<body><h1 id="top" class="title"><span aria-current="page">crm</span></h1><nav class="links"',
    );
    expect(html).toContain(
      '<main><div class="rack"><div class="unit display">',
    );
    expect(html).toContain(
      '<section class="band" aria-labelledby="orgs-band">',
    );
    expect(html).toContain('<footer class="foot">');
    expect(html).toContain('No organisations yet.');

    const manifest = JSON.parse(
      readFileSync(path.join(FE_DIST, 'manifest.json'), 'utf8'),
    );
    const [css] = manifest.entries.main.initial.css;
    const [js] = manifest.entries.main.initial.js;
    expect(html).toContain(`<link rel="stylesheet" href="${css}"/>`);
    expect(html).toContain(`<script src="${js}" defer=""></script>`);

    const asset = await get(css);
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('text/css');
  });

  test('has the "New lead" key, which opens /orgs/new', async () => {
    const html = (await get('/')).body;
    expect(html).toContain('<a class="key" href="/orgs/new">New lead</a>');
  });

  test('the band lists every organisation in its due group, with the LED of each row on the seam, and text tells each value (REQ-CRM-LCD-002)', async () => {
    await addDue('Due Last Week', dayFromToday(-7), 'Knock again');
    await addDue('Due Today', dayFromToday(0));
    await addDue('Due Tomorrow', dayFromToday(1));
    await addDue('Due Next Month', dayFromToday(30));
    await addOrg(app, cookie, { name: 'No Date', postcode: 'E1 6AN' });
    setAdded('no-date', '2026-01-01T10:00:00.000Z');

    const html = (await get('/')).body;
    const band = bandOf(html);
    // A real table: a legend over each column, and a <tbody> for each
    // group, with its name and count in a rowgroup header.
    expect(band).toContain(
      '<thead><tr><th scope="col" class="c-gutter">Due</th><th scope="col" class="c-seam"><span class="bare-text">Due now</span></th><th scope="col" class="c-name"><span class="arrow" aria-hidden="true"></span>Organisation</th><th scope="col" class="c-stage">Stage</th><th scope="col" class="c-action">Next action</th><th scope="col" class="c-due">Due date<span class="order" aria-hidden="true"> ▲</span></th><th scope="col" class="c-last">Last activity</th><th scope="col" class="c-postcode">Postcode</th></tr></thead>',
    );
    const groups = [
      ...band.matchAll(
        /<tbody><tr><th scope="rowgroup" rowSpan="(\d+)" class="c-gutter"><span class="group">([^<]+)<\/span> <span class="count">(\d+)<\/span>/gi,
      ),
    ].map((m) => `${m[2]} ${m[3]}`);
    expect(groups).toEqual([
      'Overdue 1',
      'Today 1',
      'Next 7 days 1',
      'Later 1',
      'None 1',
    ]);
    // The LED of a row is on the seam: lit when its next action is due
    // today or overdue. The seam says the same in text.
    const led = (slug: string) =>
      /<td class="c-seam"><span class="(led(?: on)?)" aria-hidden="true"><\/span><span class="bare-text">(Yes|No)<\/span><\/td>/
        .exec(rowOf(band, slug))
        ?.slice(1)
        .join(' ');
    expect(led('due-last-week')).toBe('led on Yes');
    expect(led('due-today')).toBe('led on Yes');
    expect(led('due-tomorrow')).toBe('led No');
    expect(led('no-date')).toBe('led No');
    // No LED is on the paper of a row.
    for (const slug of ['due-last-week', 'no-date']) {
      expect(
        rowOf(band, slug).replace(/<td class="c-seam">.*?<\/td>/, ''),
      ).not.toMatch(/class="led/);
    }
    // Text tells each value. Overdue shows in the group name and in words.
    // A row of Today shows only "today", because its group has one day.
    expect(bodyText(rowOf(band, 'due-last-week'))).toBe(
      `Overdue 1 Yes Due Last Week Lead Knock again ${formatDate(dayFromToday(-7))} · 7 days overdue ${formatDate(today())} None`,
    );
    expect(bodyText(rowOf(band, 'due-today'))).toBe(
      `Today 1 Yes Due Today Lead Call today ${formatDate(today())} None`,
    );
    expect(rowOf(band, 'due-today')).toContain(
      `<td class="c-due"><time dateTime="${dayFromToday(0)}`,
    );
    expect(bodyText(rowOf(band, 'due-tomorrow'))).toBe(
      `Next 7 days 1 No Due Tomorrow Lead Call ${formatDate(dayFromToday(1))} · tomorrow ${formatDate(today())} None`,
    );
    expect(bodyText(rowOf(band, 'no-date'))).toBe(
      'None 1 No No Date Lead None None 2026-Jan-01 E1 6AN',
    );
    // The glass reads the first organisation and the counts.
    expect(bodyText(divOf(html, 'glass'))).toBe(
      `First in list Due Last Week Knock again ${formatDate(dayFromToday(-7))} · 7 days overdue Overdue 1 Today 1 Showing 1–5 of 5`,
    );
    expect(divOf(html, 'glass')).toContain('<dd class="line mark">');
  });

  test('the default order: due and overdue first, the oldest due first, then the rest by last activity, the newest first', async () => {
    await addThree();
    await addDue('Due Today', dayFromToday(0));
    await addDue('Due Last Week', dayFromToday(-7));
    await addDue('Due Tomorrow', dayFromToday(1));
    setAdded('due-tomorrow', '2026-05-01T10:00:00.000Z');
    expect(await names('/')).toEqual([
      'Due Last Week',
      'Due Today',
      'Due Tomorrow',
      'Bravo',
      'Alpha',
      'Charlie',
    ]);
    // The Due key is lit, and the module says the order.
    const html = (await get('/')).body;
    expect(html).not.toMatch(/data-direction=/);
    expect(html).toContain(
      '<button type="submit" class="key latch" aria-pressed="true">Due<span class="latch-state" aria-hidden="true"> (current)</span></button>',
    );
    expect(bodyText(html)).toContain('Sort Due first');
  });

  test('the last activity is the newest of the last visit, the last note and the added date', async () => {
    await addThree();
    const band = bandOf((await get('/')).body);
    expect(bodyText(rowOf(band, 'bravo'))).toEndWith(
      'Bravo Lead None None 2026-Apr-01 None',
    );
    expect(bodyText(rowOf(band, 'alpha'))).toBe(
      'No Alpha Lead None None 2026-Mar-15 None',
    );
    expect(bodyText(rowOf(band, 'charlie'))).toBe(
      'No Charlie Lead None None 2026-Mar-01 None',
    );
  });

  test('each sort orders the list in each group, ascending and descending', async () => {
    await addThree();
    expect(await names('/?sort=added&dir=asc')).toEqual([
      'Bravo',
      'Alpha',
      'Charlie',
    ]);
    expect(await names('/?sort=added&dir=desc')).toEqual([
      'Charlie',
      'Alpha',
      'Bravo',
    ]);
    expect(await names('/?sort=name&dir=asc')).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(await names('/?sort=name&dir=desc')).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
    // A sort that does not exist gives the default order.
    expect(await names('/?sort=nope&dir=desc')).toEqual(await names('/'));
    expect(await names('/?sort=activity&dir=asc')).toEqual(await names('/'));
    // The groups stay in their order: the sort sets the order in each
    // group.
    await addDue('Zulu Due', dayFromToday(-1));
    await addDue('Able Later', dayFromToday(20));
    expect(await names('/?sort=name&dir=asc')).toEqual([
      'Zulu Due',
      'Able Later',
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });

  test('the Date added sort shows the date added in the place of the last activity', async () => {
    await addThree();
    const band = bandOf((await get('/?sort=added&dir=asc')).body);
    expect(band).toContain(
      '<th scope="col" class="c-last">Date added<span class="order" aria-hidden="true"> ▲</span></th>',
    );
    expect(bodyText(rowOf(band, 'bravo'))).toEndWith(
      'Bravo Lead None None 2026-Jan-01 None',
    );
  });

  test('the band legend shows the arrow of the order on the column that sets it, and text tells the order (REQ-CRM-LCD-002)', async () => {
    await addThree();
    const legends = async (url: string) => {
      const html = (await get(url)).body;
      const head = /<thead>.*?<\/thead>/.exec(bandOf(html))?.[0] ?? '';
      return {
        name: /class="c-name"><span class="arrow" aria-hidden="true">([^<]*)<\/span>/.exec(
          head,
        )?.[1],
        others: [
          ...head.matchAll(
            /<th scope="col" class="(c-\w+)">([^<]+)<span class="order" aria-hidden="true">([^<]+)<\/span>/g,
          ),
        ].map((m) => `${m[1]} ${m[2]}${m[3]}`),
        text: /<p class="info">([^<]*)<\/p>/.exec(html)?.[1],
      };
    };
    expect(await legends('/')).toEqual({
      name: '',
      others: ['c-due Due date ▲'],
      text: 'Sorted by due date, oldest first',
    });
    expect(await legends('/?sort=name&dir=asc')).toEqual({
      name: '▲',
      others: [],
      text: 'In each group, sorted by name, A to Z',
    });
    expect(await legends('/?sort=name&dir=desc')).toEqual({
      name: '▼',
      others: [],
      text: 'In each group, sorted by name, Z to A',
    });
    expect(await legends('/?sort=added&dir=asc')).toEqual({
      name: '',
      others: ['c-last Date added ▲'],
      text: 'In each group, sorted by date added, oldest first',
    });
    expect(await legends('/?sort=added&dir=desc')).toEqual({
      name: '',
      others: ['c-last Date added ▼'],
      text: 'In each group, sorted by date added, newest first',
    });
    // The sort key says its name, and its direction with no page styles.
    expect(bodyText((await get('/?sort=name&dir=asc')).body)).toContain(
      'Name , A to Z',
    );
  });

  test('a sort key sorts ascending, then descending, then sets the default sort of the page, and a different key replaces the sort', () => {
    const none = { sort: 'due', dir: 'asc' } as const;
    expect(nextSort(none, 'name')).toEqual({ sort: 'name', dir: 'asc' });
    expect(nextSort({ sort: 'name', dir: 'asc' }, 'name')).toEqual({
      sort: 'name',
      dir: 'desc',
    });
    expect(nextSort({ sort: 'name', dir: 'desc' }, 'name')).toEqual(none);
    expect(nextSort({ sort: 'name', dir: 'desc' }, 'added')).toEqual({
      sort: 'added',
      dir: 'asc',
    });
    // The Due key sets Due.
    expect(nextSort({ sort: 'added', dir: 'asc' }, 'due')).toEqual(none);
    expect(nextSort(none, 'due')).toEqual(none);
    // In the address book, the default sort is Name, A to Z.
    expect(nextSort({ sort: 'name', dir: 'desc' }, 'name', 'name')).toEqual({
      sort: 'name',
      dir: 'asc',
    });
  });

  test('each sort key is a GET form that keeps the search and the stage, with plain state text and an LED green for ascending and red for descending', async () => {
    const html = (await get('/?q=acme&stage=lead&sort=name&dir=asc')).body;
    // The lit key: the next press sorts descending.
    expect(html).toContain(
      `${LIST_FORM}<input type="hidden" name="q" value="acme"/><input type="hidden" name="stage" value="lead"/><input type="hidden" name="sort" value="name"/><input type="hidden" name="dir" value="desc"/><button type="submit" class="key latch" aria-pressed="true" data-direction="asc">Name<span class="bare-text">, A to Z</span></button></form>`,
    );
    // A key that is not lit: the next press sorts ascending by that key.
    expect(html).toContain(
      '<input type="hidden" name="sort" value="added"/><input type="hidden" name="dir" value="asc"/><button type="submit" class="key latch" aria-pressed="false">Date added</button>',
    );
    expect(bodyText(html)).toContain('Sort A to Z');
    // The Due key keeps the search and the stage, and sets no sort.
    expect(html).toContain(
      `${LIST_FORM}<input type="hidden" name="q" value="acme"/><input type="hidden" name="stage" value="lead"/><button type="submit" class="key latch" aria-pressed="false">Due</button></form>`,
    );

    // The third press removes the sort: the form has no sort field.
    const desc = (await get('/?q=acme&sort=name&dir=desc')).body;
    expect(desc).toContain(
      `${LIST_FORM}<input type="hidden" name="q" value="acme"/><button type="submit" class="key latch" aria-pressed="true" data-direction="desc">Name<span class="bare-text">, Z to A</span></button></form>`,
    );
    expect(bodyText(desc)).toContain('Sort Z to A');
    const added = (await get('/?sort=added&dir=desc')).body;
    expect(bodyText(added)).toContain('Date added , Newest first');
  });

  test('the search and the stage keys are one GET form, which keeps the sort', async () => {
    const html = (await get('/?q=acme&stage=quoted&sort=added&dir=desc')).body;
    const start = html.indexOf(
      `${LIST_FORM}<section id="search" class="module span-3"><h2 class="label">Search</h2>`,
    );
    expect(start).toBeGreaterThan(-1);
    const form = html.slice(start, html.indexOf('</form>', start));
    // With a search in the URL, the field has autofocus, so a full page
    // load puts the cursor back in it.
    expect(form).toContain(
      '<input id="q" type="search" placeholder="Name or postcode" autofocus="" name="q" value="acme"/>',
    );
    // The Search key comes first, so the Enter key sends it. It keeps the
    // sort and the stage that is lit.
    expect(form.indexOf('>Search</button>')).toBeLessThan(
      form.indexOf('class="key latch"'),
    );
    expect(form).toContain(
      '<span id="search-send" class="send"><input type="hidden" name="sort" value="added"/><input type="hidden" name="dir" value="desc"/><button type="submit" class="key" value="quoted" name="stage">Search</button></span>',
    );
    expect(form).toContain(
      '<button type="submit" class="key latch" aria-pressed="false" value="" name="stage">All</button>',
    );
    expect(form).toContain(
      '<button type="submit" class="key latch" aria-pressed="true" value="quoted" name="stage">Quoted<span class="latch-state" aria-hidden="true"> (current)</span></button>',
    );
  });

  test('searches the name and the postcode, and filters by stage', async () => {
    await addOrg(app, cookie, { name: 'Zed Bakery', postcode: 'sw1a 1aa' });
    const slug = await addOrg(app, cookie, {
      name: 'Acme Plumbing',
      postcode: 'E1 6AN',
    });
    await postForm(app, `/orgs/${slug}/stage`, { stage: 'quoted' }, cookie);
    await addOrg(app, cookie, { name: '100% Cotton' });

    expect(await names('/?q=ACME')).toEqual(['Acme Plumbing']);
    expect(await names('/?q=SW1A1AA')).toEqual(['Zed Bakery']);
    expect(await names('/?q=e1%206')).toEqual(['Acme Plumbing']);
    // A % in the search matches only a %.
    expect(await names('/?q=%25')).toEqual(['100% Cotton']);
    expect(await names('/?stage=quoted')).toEqual(['Acme Plumbing']);
    expect(await names('/?stage=lead&sort=name&dir=asc')).toEqual([
      '100% Cotton',
      'Zed Bakery',
    ]);
    expect(await names('/?stage=nope')).toHaveLength(3);
    expect(await names('/?q=zed&stage=quoted')).toEqual([]);
    expect((await get('/?q=zed&stage=quoted')).body).toContain(
      'No organisation matches.',
    );
  });

  test(`shows ${PAGE_SIZE} rows on a page, with the pager on the plate`, async () => {
    const rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      return `('id-${n}', 'org-${n}', 'Org ${n}', 'lead', '2026-01-01T10:00:${n}.000Z')`;
    });
    db.exec(
      `INSERT INTO organisation (id, slug, name, stage, created_at) VALUES ${rows.join(', ')};`,
    );

    const first = await names('/?sort=name&dir=asc');
    expect(first).toHaveLength(PAGE_SIZE);
    expect(first[0]).toBe('Org 00');
    const html = (await get('/?sort=name&dir=asc')).body;
    const plate = divOf(html, 'plate');
    // Each key has its caption under it: the page that it opens, or why
    // it is off (REQ-CRM-BUTTON-001).
    expect(plate).toBe(
      '<div class="plate"><div class="plate-key"><button type="button" class="key" id="page-prev" aria-describedby="page-prev-caption" disabled="" title="First page">Prev</button> <span class="caption" id="page-prev-caption">First page</span></div><div class="plate-key"><a class="key" id="page-next" href="/?sort=name&amp;dir=asc&amp;page=2" rel="next" aria-describedby="page-next-caption">Next</a> <span class="caption" id="page-next-caption">Page 2 of 2</span></div></div>',
    );
    expect(bodyText(divOf(html, 'glass'))).toContain(
      `Showing 1–${PAGE_SIZE} of ${PAGE_SIZE + 5}`,
    );
    // The pager is not in the footer.
    expect(html.slice(html.indexOf('<footer'))).not.toContain('page-');

    const second = await names('/?sort=name&dir=asc&page=2');
    expect(second).toEqual(['Org 50', 'Org 51', 'Org 52', 'Org 53', 'Org 54']);
    const last = (await get('/?sort=name&dir=asc&page=2')).body;
    expect(divOf(last, 'plate')).toContain(
      '<a class="key" id="page-prev" href="/?sort=name&amp;dir=asc" rel="prev" aria-describedby="page-prev-caption">Prev</a> <span class="caption" id="page-prev-caption">Page 1 of 2</span>',
    );
    expect(last).not.toContain('rel="next"');
    expect(last).toContain(
      'id="page-next" aria-describedby="page-next-caption" disabled=""',
    );
    expect(bodyText(divOf(last, 'glass'))).toContain(
      `Showing ${PAGE_SIZE + 1}–${PAGE_SIZE + 5} of ${PAGE_SIZE + 5}`,
    );
    // A page after the last page shows the last page.
    expect(await names('/?sort=name&dir=asc&page=9')).toEqual(second);
    // A short list has the pager too, with both keys off.
    const short = (await get('/?q=Org%2000')).body;
    expect(short).not.toContain('rel="next"');
    expect(short).toContain(
      'id="page-prev" aria-describedby="page-prev-caption" disabled=""',
    );
    expect(bodyText(divOf(short, 'glass'))).toContain('Showing 1–1 of 1');
    expect(short).toContain(
      'id="page-next" aria-describedby="page-next-caption" disabled=""',
    );
  });

  test('each key of the list is a plain form or link, and the search field has an id (REQ-CRM-MORPH-001)', async () => {
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      return `('id-${n}', 'org-${n}', 'Org ${n}', 'lead', '2026-01-01T10:00:${n}.000Z')`;
    });
    db.exec(
      `INSERT INTO organisation (id, slug, name, stage, created_at) VALUES ${rows.join(', ')};`,
    );
    const html = (await get('/?page=2')).body;
    // The morph (crm-fe/src/morph.ts) needs no marks: each form and link
    // is a plain one.
    expect(html).not.toContain('data-swap');
    const forms = [...html.matchAll(/<form ([^>]*)>/g)].map((m) => m[1]);
    expect(forms).toEqual([
      'action="/logout" method="post"',
      'action="/" method="get"',
      'action="/" method="get"',
      'action="/" method="get"',
      'action="/" method="get"',
    ]);
    expect(html).toContain(
      'rel="prev" aria-describedby="page-prev-caption">Prev</a>',
    );
    expect(html).toContain('<a class="key" href="/orgs/new">New lead</a>');
    // With an id, the morph keeps the same field, with its focus and its
    // caret. With no search, it has no autofocus.
    expect(html).toContain(
      '<section id="search" class="module span-3"><h2 class="label">Search</h2><div class="search"><label class="field"><span class="bare-text">Name or postcode </span><input id="q" type="search" placeholder="Name or postcode" name="q" value=""/></label><span id="search-send" class="send">',
    );
  });

  test('/ is the Plan and /orgs is the address book, and the forms of each submit to its own path', async () => {
    await addThree();
    await addOrg(app, cookie, { name: '4 Seasons' });
    for (const path of LIST_PATHS) {
      const html = (await get(`${path}?sort=name&dir=asc&q=a`)).body;
      expect(html).toContain(
        `<title>${path === '/' ? 'Organisations' : 'Address book'} - crm</title>`,
      );
      const actions = [
        ...html.matchAll(/<form action="([^"]+)" method="get">/g),
      ]
        .map((m) => m[1])
        .filter((action) => action !== '/orgs/new');
      expect(actions).toHaveLength(4);
      expect(new Set(actions)).toEqual(new Set([path]));
    }
    expect((await get('/orgs')).body).toContain(
      '<h1 id="top" class="title"><a href="/">crm</a><span class="path"> / <span class="here" aria-current="page">orgs</span></span></h1>',
    );
    // The Plan is grouped by due date. The address book is A to Z by
    // default, grouped by the first letter in the gutter.
    expect(gutterOf((await get('/')).body)).toEqual(['None 4']);
    const book = (await get('/orgs')).body;
    expect(gutterOf(book)).toEqual(['# 1', 'A 1', 'B 1', 'C 1']);
    expect(await names('/orgs')).toEqual([
      '4 Seasons',
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(bodyText(book)).toContain(
      'Organisations A to Z Sorted by name, A to Z',
    );
    expect(book).toContain('<th scope="col" class="c-gutter">Letter</th>');
    // The sort keys of the address book: Name is on, and its next press
    // sorts Z to A. The groups follow the order.
    expect(book).toContain(
      '<form action="/orgs" method="get"><input type="hidden" name="sort" value="name"/><input type="hidden" name="dir" value="desc"/><button type="submit" class="key latch" aria-pressed="true" data-direction="asc">Name',
    );
    expect(gutterOf((await get('/orgs?sort=name&dir=desc')).body)).toEqual([
      'C 1',
      'B 1',
      'A 1',
      '# 1',
    ]);
    // Date added groups by the month added. Due groups by due date.
    expect(gutterOf((await get('/orgs?sort=added&dir=asc')).body)).toEqual([
      '2026-Jan 1',
      '2026-Feb 1',
      '2026-Mar 1',
      expect.stringMatching(/^\d{4}-[A-Z][a-z]{2} 1$/),
    ]);
    expect(gutterOf((await get('/orgs?sort=due')).body)).toEqual(['None 4']);
    // The stage keys and the search filter the address book too.
    expect(await names('/orgs?q=br')).toEqual(['Bravo']);
    expect(await names('/orgs?stage=quoted')).toEqual([]);
  });

  test('a search with no match offers New lead, with the search text', async () => {
    await addThree();
    const html = (await get('/?q=Corner%20Cafe')).body;
    expect(html).toContain(
      '<td colSpan="8" class="empty">No organisation matches “Corner Cafe”. <a href="/orgs/new?name=Corner+Cafe">New lead: Corner Cafe</a></td>',
    );
    // The New lead key carries the search text, and it is the key that
    // the page offers (a thick outline).
    expect(html).toContain(
      '<a class="key fix" href="/orgs/new?name=Corner+Cafe">New lead</a>',
    );
    expect((await get('/?q=al')).body).toContain(
      '<a class="key" href="/orgs/new?name=al">New lead</a>',
    );
    // The new lead form starts with the search text in the name.
    expect((await get('/orgs/new?name=Corner+Cafe')).body).toContain(
      'name="name" value="Corner Cafe"/>',
    );
  });
});

describe('last activity', () => {
  /** The time that the organisation of the test was added. */
  const OLD = '2026-01-01T10:00:00.000Z';

  /** The last activity of the row of `slug` in the list, as its ISO value. */
  const lastActivity = async (slug: string) => {
    const html = (await get('/')).body;
    const cell = /<td class="c-last">(.*?)<\/td>/.exec(rowOf(html, slug))?.[1];
    return /dateTime="([^"]+)"/.exec(cell ?? '')?.[1];
  };

  /** Tap the Undo key of the organisation page of `slug`. */
  const undo = async (slug: string) => {
    const html = (await get(`/orgs/${slug}`)).body;
    const event = html.match(
      new RegExp(
        `<form action="/orgs/${slug}/undo" method="post"><input type="hidden" name="event" value="(\\d+)"`,
      ),
    )?.[1];
    expect(event).toBeTruthy();
    const response = await postForm(
      app,
      `/orgs/${slug}/undo`,
      { event: String(event) },
      cookie,
    );
    expect(response.statusCode).toBe(303);
  };

  test('a hidden visit or note is not the last activity: log a visit, undo it, and the list shows the time before the visit', async () => {
    const slug = await addOrg(app, cookie, { name: 'Acme' });
    db.query('UPDATE organisation SET created_at = ? WHERE slug = ?;').run(
      OLD,
      slug,
    );
    const before = await lastActivity(slug);
    expect(before?.slice(0, 10)).toBe('2026-01-01');

    await postForm(
      app,
      `/orgs/${slug}/activity`,
      { outcome: 'spoke', note: '' },
      cookie,
    );
    expect(await lastActivity(slug)).not.toBe(before);
    await undo(slug);
    expect(db.query('SELECT hidden_at FROM visit;').get()).toEqual({
      hidden_at: expect.any(String),
    });
    expect(await lastActivity(slug)).toBe(before);

    // The same for a note.
    await postForm(
      app,
      `/orgs/${slug}/activity`,
      { outcome: 'note', note: 'Back on Monday' },
      cookie,
    );
    expect(await lastActivity(slug)).not.toBe(before);
    await undo(slug);
    expect(await lastActivity(slug)).toBe(before);
  });
});

describe('the page anatomy', () => {
  test('the path title is the first element in <body>, and each part above the page is a link', async () => {
    const slug = await addFullOrg();
    const titles: Record<string, string> = {
      '/': '<h1 id="top" class="title"><span aria-current="page">crm</span></h1>',
      '/orgs/new':
        '<h1 id="top" class="title"><a href="/">crm</a><span class="path"> / <a href="/orgs">orgs</a> / <span class="here" aria-current="page">new</span></span></h1>',
      [`/orgs/${slug}`]: `<h1 id="top" class="title"><a href="/">crm</a><span class="path"> / <a href="/orgs">orgs</a> / <span class="here" aria-current="page">${slug}</span></span></h1>`,
      '/account/passkeys':
        '<h1 id="top" class="title"><a href="/">crm</a><span class="path"> / <a href="/account">account</a> / <span class="here" aria-current="page">passkeys</span></span></h1>',
    };
    for (const [url, title] of Object.entries(titles)) {
      const html = (await get(url)).body;
      expect(html).toContain(`<body>${title}<nav class="links"`);
      expect(html).toContain('<a href="#top">top</a>');
    }
  });

  test('a signed-out page has the path title and the footer, and no app links', async () => {
    const html = (await get('/login', {})).body;
    expect(html).toContain(
      '<body><h1 id="top" class="title"><a href="/">crm</a><span class="path"> / <span class="here" aria-current="page">login</span></span></h1><main>',
    );
    expect(html).not.toContain('<nav class="links"');
    expect(html).toContain('<footer class="foot">');
  });

  test('the nav links each app page, and the link to this page is text', async () => {
    for (const path of LIST_PATHS) {
      const html = (await get(path)).body;
      const nav = html.slice(
        html.indexOf('<nav class="links"'),
        html.indexOf('</nav>'),
      );
      // orgs is the address book. It is not the home, so the home links it.
      if (path === '/orgs') {
        expect(nav).toContain('<span aria-current="page">orgs</span>');
        expect(nav).not.toContain('<a href="/orgs">');
      } else {
        expect(nav).toContain('<a href="/orgs">orgs</a>');
      }
      expect(nav).toContain('<a href="/orgs/new">new lead</a>');
      expect(nav).toContain('<a href="/account">account</a>');
      expect(nav).toContain(
        '<form action="/logout" method="post"><button type="submit" class="link">sign out</button></form>',
      );
    }
    const account = (await get('/account')).body;
    expect(account).toContain('<a href="/orgs">orgs</a>');
  });

  test('the footer has privacy and top, and no theme or mode stepper', async () => {
    const html = (await get('/')).body;
    expect(html).toContain(
      '<footer class="foot"><nav class="foot-links" aria-label="Page"><a href="/privacy">privacy</a> <a href="#top">top</a></nav></footer>',
    );
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).not.toContain('theme=bare');
    // The mode follows the system. No route keeps a mode.
    const mode = await postForm(app, '/mode', { mode: 'dark' }, cookie);
    expect(mode.statusCode).toBe(404);
    expect(mode.cookies).toEqual([]);
  });

  test('no LCD holds a form control, a heading or help text, and only a menu has links', async () => {
    const slug = await addFullOrg();
    const [, , activityEdit] = editPages((await get(`/orgs/${slug}`)).body);
    const pages = [
      '/',
      '/orgs?q=acme&sort=name&dir=desc',
      `/orgs/${slug}`,
      activityEdit,
      '/account',
      '/account/passkeys',
      '/account/sessions',
    ];
    const htmls = await Promise.all(
      pages.map(async (url) => (await get(url)).body),
    );
    htmls.push((await postForm(app, '/orgs/new', { name: ' ' }, cookie)).body);
    htmls.push((await postForm(app, '/login', {})).body);
    let lcds = 0;
    for (const html of htmls) {
      const lcd = divOf(html, 'lcd');
      if (!lcd) continue;
      lcds += 1;
      expect(lcd).not.toMatch(/<(form|input|button|select|textarea|h1|h2)\b/);
      expect(lcd.replace(/<ol class="menu[\s\S]*<\/ol>/, '')).not.toContain(
        '<a ',
      );
    }
    expect(lcds).toBeGreaterThanOrEqual(3);
  });
});

describe('every page with ?theme=bare', () => {
  test('every page shows each state and allows each action with no page styles and no JavaScript (REQ-CRM-BARE-001)', async () => {
    const slug = await addFullOrg();
    const orgHtml = (await get(`/orgs/${slug}`)).body;

    const pages = [
      '/',
      '/?q=acme&stage=quoted&sort=name&dir=desc',
      '/orgs/new',
      `/orgs/${slug}`,
      ...editPages(orgHtml),
      '/account',
      '/account/sessions',
      '/privacy',
    ];
    const bare: Record<string, string> = {};
    for (const page of pages) {
      const sep = page.includes('?') ? '&' : '?';
      const themed = (await get(page)).body;
      const html = (await get(`${page}${sep}theme=bare`)).body;
      bare[page] = html;

      // No page styles and no scripts.
      expect(html).not.toContain('<link');
      expect(html).not.toContain('<style');
      expect(html).not.toContain(' style="');
      expect(html).not.toContain('<script');

      // The bare page has all the text of the themed page.
      expect(bodyText(html)).toBe(bodyText(themed));

      // The nav is a plain list of links.
      expect(html).toContain('<nav class="links" aria-label="crm"><ul><li>');

      // Each action is a form with a string action and a submit button.
      // A form with an id can have its button out of it, with a `form`
      // attribute: a key on the plate, or the last row of a table.
      const forms = html.split('<form').slice(1);
      expect(forms.length).toBeGreaterThan(0);
      for (const form of forms) {
        const tag = form.slice(0, form.indexOf('>'));
        expect(tag).toMatch(/ action="\/[^"]*"/);
        expect(tag).toMatch(/ method="(get|post)"/);
        const id = tag.match(/ id="([^"]+)"/)?.[1];
        if (
          id &&
          new RegExp(`<button type="submit"[^>]* form="${id}"`).test(html)
        ) {
          continue;
        }
        expect(form.slice(0, form.indexOf('</form>'))).toContain(
          '<button type="submit"',
        );
      }
    }

    // Home: text carries each value and the due state, in a real table.
    expect(bodyText(bare['/'])).toContain(
      'Overdue 1 Yes Acme Plumbing Quoted Chase quote 2000-Jan-01 · ',
    );
    expect(bodyText(bare['/'])).toContain('days overdue');
    expect(bare['/']).toContain('<th scope="rowgroup"');

    // Home with a search, a stage and a sort: attributes carry the search,
    // and text carries the stage and the sort direction.
    const search = bare['/?q=acme&stage=quoted&sort=name&dir=desc'];
    expect(search).toContain(
      '<input id="q" type="search" placeholder="Name or postcode" autofocus="" name="q" value="acme"/>',
    );
    expect(bodyText(search)).toContain('Quoted (current)');
    expect(bodyText(search)).toContain('Name , Z to A');
    expect(bodyText(search)).toContain('In each group, sorted by name, Z to A');
    expect(bodyText(search)).toContain('All Lead Visited');

    // /orgs/new: an attribute marks the field that the form needs.
    expect(bare['/orgs/new']).toContain('<input required="" name="name"/>');

    // The organisation page: text and attributes carry each state, and each
    // Save as visit button and each stage is one submit button. The
    // Activity band is a real table, open.
    const org = bare[`/orgs/${slug}`];
    expect(org).toContain('<th scope="rowgroup"');
    expect(org).toContain(
      '<button type="submit" class="key latch" aria-pressed="true" value="quoted" name="stage">',
    );
    expect(bodyText(org)).toContain('Quoted (current)');
    expect(org).toContain('value="2000-01-01"');
    expect(bodyText(org)).toContain('Next action Chase quote 2000-Jan-01');
    expect(bodyText(org)).toContain('Wants a site');
    expect(bodyText(org)).toContain('Owner is Ann');
    expect(bodyText(org)).toContain('Ann Smith');
    for (const outcome of [
      'no_answer',
      'spoke',
      'call_back',
      'not_interested',
      'do_not_knock',
    ]) {
      expect(org).toContain(
        `<button type="submit" class="key" value="${outcome}" name="outcome">`,
      );
    }

    // The edit page of a visit or a note: the LED of one Save as button is
    // on, and text says which.
    const [, , activityEdit] = editPages(orgHtml);
    expect(bodyText(bare[activityEdit]).match(/\(current\)/g)).toHaveLength(1);
    // The sessions page: a revoke key for each other session is a form.
    expect(bodyText(bare['/account/sessions'])).toContain('(this session)');
  });
});
