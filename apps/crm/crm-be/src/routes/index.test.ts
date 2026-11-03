import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatDate, today } from '../dates';
import type { buildApp } from '../index';
import { FE_DIST } from '../render';
import {
  addOrg,
  bodyText,
  divOf,
  postForm,
  signInAdmin,
  testApp,
} from '../test-helpers';

let app: ReturnType<typeof buildApp>;
let close: () => Promise<void>;
let cookie: string;

beforeEach(() => {
  ({ app, close } = testApp());
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

describe('GET /', () => {
  test('renders the Today page in the page anatomy, with the assets', async () => {
    const response = await get('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');

    const html = response.body;
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toContain('<title>Today - crm</title>');
    expect(html).toContain(
      '<body><h1 id="top" class="title"><span aria-current="page">crm</span></h1><nav class="links"',
    );
    expect(html).toContain('<div class="device"><div class="lcd">');
    expect(html).toContain('<footer class="foot">');
    expect(html).toContain('Nothing is due.');

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

  test('the LCD lists the organisations due today or earlier, oldest first, as a menu', async () => {
    await addDue('Due Today', dayFromToday(0));
    await addDue('Due Last Week', dayFromToday(-7), 'Knock again');
    await addDue('Due Tomorrow', dayFromToday(1));
    await addOrg(app, cookie, { name: 'No Date' });

    const html = (await get('/')).body;
    const lcd = divOf(html, 'lcd');
    expect(lcd).toContain('<dt>Due</dt><dd>2</dd>');
    expect(lcd).toContain(
      '<dt>Overdue</dt><dd><span class="led on">1</span></dd>',
    );
    const text = bodyText(lcd);
    expect(text).not.toContain('Due Tomorrow');
    expect(text).not.toContain('No Date');
    expect(text.indexOf('Due Last Week')).toBeLessThan(
      text.indexOf('Due Today'),
    );
    expect(lcd).toContain(
      '<a href="/due-last-week"><span class="name">Due Last Week</span>',
    );
    // The status words come next to the date, never in place of it.
    expect(text).toContain(
      `Due Last Week ${formatDate(dayFromToday(-7))} Knock again 7 days overdue`,
    );
    expect(text).toContain(
      `Due Today ${formatDate(dayFromToday(0))} Call today`,
    );
    expect(lcd).toContain('<span class="led on">7 days overdue</span>');
    expect(lcd).toContain('<span class="led">today</span>');
  });
});

describe('the page anatomy', () => {
  test('the path title is the first element in <body>, and each part above the page is a link', async () => {
    const slug = await addFullOrg();
    const titles: Record<string, string> = {
      '/': '<h1 id="top" class="title"><span aria-current="page">crm</span></h1>',
      '/orgs':
        '<h1 id="top" class="title"><a href="/">crm</a><span class="path"> / <span class="here" aria-current="page">orgs</span></span></h1>',
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
    const html = (await get('/orgs')).body;
    const nav = html.slice(
      html.indexOf('<nav class="links"'),
      html.indexOf('</nav>'),
    );
    expect(nav).toContain('<a href="/">today</a>');
    expect(nav).toContain('<span aria-current="page">orgs</span>');
    expect(nav).not.toContain('<a href="/orgs">');
    expect(nav).toContain('<a href="/orgs/new">new lead</a>');
    expect(nav).toContain('<a href="/account">account</a>');
    expect(nav).toContain(
      '<form action="/logout" method="post"><button type="submit" class="link">sign out</button></form>',
    );
  });

  test('no LCD holds a form control, a heading or help text, and only a menu has links', async () => {
    const slug = await addFullOrg();
    const pages = [
      '/',
      '/orgs',
      '/orgs?q=acme',
      `/orgs/${slug}`,
      `/orgs/${slug}/edit`,
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
      expect(lcd.replace(/<ol class="menu"[\s\S]*<\/ol>/, '')).not.toContain(
        '<a ',
      );
    }
    expect(lcds).toBe(htmls.length);
  });

  test('the theme stepper links this URL in the other theme', async () => {
    const themed = (await get('/orgs?q=acme')).body;
    expect(themed).toContain(
      '<a class="step" href="/orgs?q=acme&amp;theme=bare" aria-label="Theme: Bare">',
    );
    const bare = (await get('/orgs?q=acme&theme=bare')).body;
    expect(bare).toContain(
      '<a class="step" href="/orgs?q=acme" aria-label="Theme: Pixel-3">',
    );
  });
});

describe('POST /mode', () => {
  test('keeps the mode in a cookie, and each page then has it on <html>', async () => {
    const response = await postForm(
      app,
      '/mode',
      { mode: 'dark', next: '/orgs' },
      cookie,
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/orgs');
    const mode = response.cookies.find((c) => c.name === 'crm_mode');
    expect(mode?.value).toBe('dark');

    const html = (await get('/orgs', { cookie: `${cookie}; crm_mode=dark` }))
      .body;
    expect(html).toContain('<html lang="en" data-mode="dark">');
    expect(html).toContain('<meta name="color-scheme" content="dark"/>');
    expect(bodyText(html)).toContain('‹ Mode Dark ›');
    expect(html).toContain(
      'value="light" aria-label="Mode: Light" name="mode"',
    );
    expect(html).toContain('value="auto" aria-label="Mode: Auto" name="mode"');

    const auto = await postForm(app, '/mode', { mode: 'auto', next: '/' });
    expect(auto.statusCode).toBe(303);
    expect(auto.cookies.find((c) => c.name === 'crm_mode')?.value).toBe('');
  });

  test('a signed-out visitor can use it, and it only opens a local next', async () => {
    const response = await postForm(app, '/mode', {
      mode: 'light',
      next: '//evil.example',
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/');
    expect((await postForm(app, '/mode', { mode: 'blue' })).statusCode).toBe(
      400,
    );
  });
});

describe('every page with ?theme=bare', () => {
  test('every page shows each state and allows each action with no page styles and no JavaScript (REQ-CRM-BARE-001)', async () => {
    const slug = await addFullOrg();
    const orgHtml = (await get(`/orgs/${slug}`)).body;

    const pages = [
      '/',
      '/orgs',
      '/orgs?q=acme&stage=quoted',
      '/orgs/new',
      `/orgs/${slug}`,
      ...editPages(orgHtml),
      '/account',
      '/account/sessions',
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

      // The bare page has all the text of the themed page. Only the value
      // of the theme stepper differs.
      expect(bodyText(html).replace('Theme Bare', 'Theme Pixel-3')).toBe(
        bodyText(themed),
      );

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

    // Today: text carries the due state. The theme stepper says the theme.
    const today = bodyText(bare['/']);
    expect(today).toContain('Overdue 1');
    expect(today).toContain('Acme Plumbing 2000-Jan-01 Chase quote');
    expect(today).toContain('days overdue');
    expect(today).toContain('‹ Theme Bare ›');

    // /orgs: attributes carry the search, and the LCD the count.
    const search = bare['/orgs?q=acme&stage=quoted'];
    expect(search).toContain('<input type="search" name="q" value="acme"/>');
    expect(search).toContain(
      '<option value="quoted" selected="">Quoted</option>',
    );
    expect(search).toContain('<dt>Matches</dt><dd>1</dd>');

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
        `<button type="submit" class="key" name="outcome" value="${outcome}">`,
      );
    }

    // The edit page of a visit or a note: the LED of one Save as button is
    // on, and text says which.
    const [, , activityEdit] = editPages(orgHtml);
    expect(bodyText(bare[activityEdit]).match(/\(current\)/g)).toHaveLength(1);
  });
});
