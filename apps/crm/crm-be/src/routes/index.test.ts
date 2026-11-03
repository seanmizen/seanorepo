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
import { LIST_PATHS, LIST_SWAP, nextSort, PAGE_SIZE } from './index';

/** The attribute that makes a form or a link of the list swap in place. */
const SWAP = `data-swap="${LIST_SWAP}"`;
/** The start of a GET form of the list at `/`. */
const LIST_FORM = `<form ${SWAP} action="/" method="get">`;

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

/** The names in the menu of the LCD, in order. */
const names = async (url: string) => {
  const response = await get(url);
  expect(response.statusCode).toBe(200);
  return [
    ...response.body.matchAll(
      /<li><a href="\/orgs\/[^"]+" title="[^"]*"><span class="arrow" aria-hidden="true"><\/span><span class="name">([^<]+)<\/span>/g,
    ),
  ].map((m) => m[1]);
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
    expect(html).toContain('<div class="device"><div class="lcd">');
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
    expect(html).toContain(
      '<form action="/orgs/new" method="get"><button type="submit" class="key">New lead</button></form>',
    );
  });

  test('the LCD lists every organisation as a menu: name, stage, next action date and last activity, with a lit LED in the bezel when due (REQ-CRM-LCD-001)', async () => {
    await addDue('Due Last Week', dayFromToday(-7), 'Knock again');
    await addDue('Due Today', dayFromToday(0));
    await addDue('Due Tomorrow', dayFromToday(1));
    await addOrg(app, cookie, { name: 'No Date' });
    setAdded('no-date', '2026-01-01T10:00:00.000Z');

    const lcd = divOf((await get('/')).body, 'lcd');
    expect(lcd).toContain(
      '<ol class="menu two-lines leds" data-legend-name="Organisation" data-legend-value="Next action" data-legend-detail="Stage" data-legend-status="Last activity">',
    );
    expect(lcd).toContain(
      '<a href="/orgs/due-last-week" title="Due Last Week · Lead"><span class="arrow" aria-hidden="true"></span><span class="name">Due Last Week</span>',
    );
    // The LED of a row is lit when its next action is due today or
    // overdue. It is in the bezel: after the link of the row, in its <li>.
    const led = (slug: string) =>
      new RegExp(
        `<li><a href="/orgs/${slug}"[^>]*>.*?</a><span class="led( on)?" aria-hidden="true"></span></li>`,
      ).exec(lcd)?.[1] === ' on';
    expect(led('due-last-week')).toBe(true);
    expect(led('due-today')).toBe(true);
    expect(led('due-tomorrow')).toBe(false);
    expect(led('no-date')).toBe(false);
    // With no page styles, text tells each value and the due state.
    const text = bodyText(lcd);
    expect(text).toContain(
      `Due Last Week · next action ${formatDate(dayFromToday(-7))} (7 days overdue) · stage Lead · last activity`,
    );
    expect(text).toContain(
      `Due Today · next action ${formatDate(dayFromToday(0))} (today) · stage Lead`,
    );
    expect(text).toContain(
      `Due Tomorrow · next action ${formatDate(dayFromToday(1))} · stage Lead`,
    );
    expect(text).toContain(
      'No Date · next action None · stage Lead · last activity 2026-Jan-01',
    );
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
    // No sort key is lit, and the module says the order.
    const html = (await get('/')).body;
    expect(html).not.toMatch(/data-direction=/);
    expect(bodyText(html)).toContain('Sort Due first');
  });

  test('the last activity is the newest of the last visit, the last note and the added date', async () => {
    await addThree();
    const text = bodyText(divOf((await get('/')).body, 'lcd'));
    expect(text).toContain(
      'Bravo · next action None · stage Lead · last activity 2026-Apr-01',
    );
    expect(text).toContain(
      'Alpha · next action None · stage Lead · last activity 2026-Mar-15',
    );
    expect(text).toContain(
      'Charlie · next action None · stage Lead · last activity 2026-Mar-01',
    );
  });

  test('each sort orders the list, ascending and descending', async () => {
    await addThree();
    expect(await names('/?sort=activity&dir=asc')).toEqual([
      'Charlie',
      'Alpha',
      'Bravo',
    ]);
    expect(await names('/?sort=activity&dir=desc')).toEqual([
      'Bravo',
      'Alpha',
      'Charlie',
    ]);
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
  });

  test('the Date added sort shows the date added in the place of the last activity', async () => {
    await addThree();
    const lcd = divOf((await get('/?sort=added&dir=asc')).body, 'lcd');
    expect(lcd).toContain('data-legend-status="Date added"');
    expect(bodyText(lcd)).toContain(
      'Bravo · next action None · stage Lead · date added 2026-Jan-01',
    );
  });

  test('a sort key sorts ascending, then descending, then removes the sort, and a different key replaces the sort', () => {
    const none = { sort: '', dir: 'asc' } as const;
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

    // The third press removes the sort: the form has no sort field.
    const desc = (await get('/?q=acme&sort=name&dir=desc')).body;
    expect(desc).toContain(
      `${LIST_FORM}<input type="hidden" name="q" value="acme"/><button type="submit" class="key latch" aria-pressed="true" data-direction="desc">Name<span class="bare-text">, Z to A</span></button></form>`,
    );
    expect(bodyText(desc)).toContain('Sort Z to A');
    const activity = (await get('/?sort=activity&dir=desc')).body;
    expect(bodyText(activity)).toContain('Last activity , Newest first');
  });

  test('the search and the stage keys are one GET form, which keeps the sort', async () => {
    const html = (await get('/?q=acme&stage=quoted&sort=added&dir=desc')).body;
    const start = html.indexOf(
      `${LIST_FORM}<section class="module"><h2 class="label">Search</h2>`,
    );
    expect(start).toBeGreaterThan(-1);
    const form = html.slice(start, html.indexOf('</form>', start));
    // With a search in the URL, the field has autofocus, so a full page
    // load puts the cursor back in it.
    expect(form).toContain(
      '<input type="search" placeholder="Name or postcode" autofocus="" name="q" value="acme"/>',
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

  test(`shows ${PAGE_SIZE} rows on a page, with a pager in the footer`, async () => {
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
    const foot = html.slice(html.indexOf('<footer'));
    expect(foot).toContain(
      `<span>1–${PAGE_SIZE} of ${PAGE_SIZE + 5}</span> <a href="/?sort=name&amp;dir=asc&amp;page=2" rel="next" ${SWAP}>next</a>`,
    );
    expect(foot).not.toContain('rel="prev"');

    const second = await names('/?sort=name&dir=asc&page=2');
    expect(second).toEqual(['Org 50', 'Org 51', 'Org 52', 'Org 53', 'Org 54']);
    const last = (await get('/?sort=name&dir=asc&page=2')).body;
    expect(last).toContain(
      `<a href="/?sort=name&amp;dir=asc" rel="prev" ${SWAP}>previous</a> <span>${PAGE_SIZE + 1}–${PAGE_SIZE + 5} of ${PAGE_SIZE + 5}</span>`,
    );
    expect(last).not.toContain('rel="next"');
    // A page after the last page shows the last page.
    expect(await names('/?sort=name&dir=asc&page=9')).toEqual(second);
    // A short list has no pager.
    expect((await get('/?q=Org%2000')).body).not.toContain('rel="next"');
  });

  test('the search, the stage keys, the sort keys and the pager swap the list in place, and the search field is not in a swapped part', async () => {
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      return `('id-${n}', 'org-${n}', 'Org ${n}', 'lead', '2026-01-01T10:00:${n}.000Z')`;
    });
    db.exec(
      `INSERT INTO organisation (id, slug, name, stage, created_at) VALUES ${rows.join(', ')};`,
    );
    const html = (await get('/?page=2')).body;
    // Each GET form of the list swaps, except "New lead", which opens a
    // new page.
    const forms = [...html.matchAll(/<form ([^>]*)>/g)].map((m) => m[1]);
    expect(forms.filter((tag) => tag.includes(SWAP))).toHaveLength(4);
    expect(forms.filter((tag) => !tag.includes(SWAP))).toEqual([
      'action="/logout" method="post"',
      'action="/orgs/new" method="get"',
    ]);
    expect(html).toContain(`rel="prev" ${SWAP}>previous</a>`);
    // Each selector matches one part of the page.
    for (const part of [
      'class="lcd"',
      'id="sort"',
      'id="search-send"',
      'id="stage"',
      'class="foot"',
    ]) {
      expect(html.split(part)).toHaveLength(2);
    }
    // The search field is in the Search module, which has no id, so the
    // swap never replaces it. With no search, it has no autofocus.
    expect(html).toContain(
      '<section class="module"><h2 class="label">Search</h2><div class="search"><label class="field"><span class="bare-text">Name or postcode </span><input type="search" placeholder="Name or postcode" name="q" value=""/></label><span id="search-send" class="send">',
    );
  });

  test('/ and /orgs show the same list, and the forms of each submit to its own path', async () => {
    await addThree();
    expect(await names('/orgs?sort=name&dir=desc')).toEqual(
      await names('/?sort=name&dir=desc'),
    );
    for (const path of LIST_PATHS) {
      const html = (await get(`${path}?sort=name&dir=asc&q=a`)).body;
      expect(html).toContain('<title>Organisations - crm</title>');
      const actions = [
        ...html.matchAll(
          /<form (?:data-swap="[^"]+" )?action="([^"]+)" method="get">/g,
        ),
      ]
        .map((m) => m[1])
        .filter((action) => action !== '/orgs/new');
      expect(actions).toHaveLength(4);
      expect(new Set(actions)).toEqual(new Set([path]));
    }
    expect((await get('/orgs')).body).toContain(
      '<h1 id="top" class="title"><a href="/">crm</a><span class="path"> / <span class="here" aria-current="page">orgs</span></span></h1>',
    );
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
      expect(nav).toContain('<span aria-current="page">orgs</span>');
      expect(nav).not.toContain('<a href="/orgs">');
      expect(nav).toContain('<a href="/orgs/new">new lead</a>');
      expect(nav).toContain('<a href="/account">account</a>');
      expect(nav).toContain(
        '<form action="/logout" method="post"><button type="submit" class="link">sign out</button></form>',
      );
    }
    const account = (await get('/account')).body;
    expect(account).toContain('<a href="/orgs">orgs</a>');
  });

  test('the footer has the pager, privacy and top, and no theme or mode stepper', async () => {
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
    expect(lcds).toBeGreaterThanOrEqual(5);
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
      const forms = html.split('<form').slice(1);
      expect(forms.length).toBeGreaterThan(0);
      for (const form of forms) {
        const tag = form.slice(0, form.indexOf('>'));
        expect(tag).toMatch(/ action="\/[^"]*"/);
        expect(tag).toMatch(/ method="(get|post)"/);
        expect(form.slice(0, form.indexOf('</form>'))).toContain(
          '<button type="submit"',
        );
      }
    }

    // Home: text carries each value and the due state.
    expect(bodyText(bare['/'])).toContain(
      'Acme Plumbing · next action 2000-Jan-01 (',
    );
    expect(bodyText(bare['/'])).toContain('days overdue) · stage Quoted');

    // Home with a search, a stage and a sort: attributes carry the search,
    // and text carries the stage and the sort direction.
    const search = bare['/?q=acme&stage=quoted&sort=name&dir=desc'];
    expect(search).toContain(
      '<input type="search" placeholder="Name or postcode" autofocus="" name="q" value="acme"/>',
    );
    expect(bodyText(search)).toContain('Quoted (current)');
    expect(bodyText(search)).toContain('Name , Z to A');
    expect(bodyText(search)).toContain('All Lead Visited');

    // /orgs/new: an attribute marks the field that the form needs.
    expect(bare['/orgs/new']).toContain('<input required="" name="name"/>');

    // The organisation page: text and attributes carry each state, and each
    // Save as button and each stage is one submit button. The Activity list
    // is a <details>, so it opens with no script.
    const org = bare[`/orgs/${slug}`];
    expect(org).toContain('<details class="events"><summary>');
    expect(org).toContain(
      '<button type="submit" class="key latch" aria-pressed="true" value="quoted" name="stage">',
    );
    expect(bodyText(org)).toContain('Quoted (current)');
    expect(org).toContain('value="2000-01-01"');
    expect(bodyText(org)).toContain('Next action Chase quote Due 2000-Jan-01');
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
    expect(bodyText(bare['/account/sessions'])).toContain('This session');
  });
});
