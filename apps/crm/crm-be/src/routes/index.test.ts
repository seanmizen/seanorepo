import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { buildApp } from '../index';
import { today } from '../org';
import { FE_DIST } from '../render';
import { addOrg, postForm, signInAdmin, testApp } from '../test-helpers';

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

/** GET `url` as the signed-in person. */
const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { cookie } });

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
    `/${slug}/stage`,
    { stage: 'lead', next_action: nextAction, next_action_on: date },
    cookie,
  );
  return slug;
};

/** The text that a person reads in the `<body>`, with no markup. */
const bodyText = (html: string) =>
  html
    .slice(html.indexOf('<body>'))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('GET /', () => {
  test('renders the Today page in the panel layout with the assets', async () => {
    const response = await get('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');

    const html = response.body;
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toContain('<title>Today - crm</title>');
    expect(html).toContain('<header class="plate">');
    expect(html).toContain('<h1>Today</h1>');
    expect(html).toContain('<main class="chassis">');
    expect(html).toContain('Nothing is due on or before');

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

  test('lists the organisations due today or earlier, oldest first', async () => {
    await addDue('Due Today', dayFromToday(0));
    await addDue('Due Last Week', dayFromToday(-7), 'Knock again');
    await addDue('Due Tomorrow', dayFromToday(1));
    await addOrg(app, cookie, { name: 'No Date' });

    const html = (await get('/')).body;
    const text = bodyText(html);
    expect(text).toContain('2 due on or before');
    expect(text).not.toContain('Due Tomorrow');
    expect(text).not.toContain('No Date');
    expect(text.indexOf('Due Last Week')).toBeLessThan(
      text.indexOf('Due Today'),
    );
    expect(html).toContain('<a href="/due-last-week">Due Last Week</a>');
    expect(text).toContain(`Overdue ${dayFromToday(-7)}`);
    expect(text).toContain(`Today ${dayFromToday(0)}`);
    expect(text).toContain('Knock again');
  });
});

describe('every page with ?theme=bare', () => {
  test('every page shows each state and allows each action with no page styles and no JavaScript (REQ-CRM-BARE-001)', async () => {
    const slug = await addOrg(app, cookie, {
      name: 'Acme Plumbing',
      postcode: 'SW1A 1AA',
      contact_name: 'Ann Smith',
      phone: '07700 900000',
      email: 'ann@example.com',
      source: 'door',
    });
    await postForm(
      app,
      `/${slug}/stage`,
      {
        stage: 'quoted',
        next_action: 'Chase quote',
        next_action_on: '2000-01-01',
      },
      cookie,
    );
    await postForm(
      app,
      `/${slug}/visits`,
      { outcome: 'spoke', note: 'Wants a site' },
      cookie,
    );
    await postForm(app, `/${slug}/notes`, { body: 'Owner is Ann' }, cookie);

    const pages = [
      '/',
      '/orgs',
      '/orgs?q=acme&stage=quoted',
      '/orgs/new',
      `/${slug}`,
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

    // Today: text carries the due state. An attribute carries the theme.
    expect(bodyText(bare['/'])).toContain('Overdue 2000-01-01');
    expect(bare['/']).toContain(
      '<option value="bare" selected="">Bare</option>',
    );

    // /orgs: attributes carry the search.
    const search = bare['/orgs?q=acme&stage=quoted'];
    expect(search).toContain('<input type="search" name="q" value="acme"/>');
    expect(search).toContain(
      '<option value="quoted" selected="">Quoted</option>',
    );
    expect(bodyText(search)).toContain('1 organisation matches the search.');

    // /orgs/new: an attribute marks the field that the form needs.
    expect(bare['/orgs/new']).toContain('<input required="" name="name"');

    // The organisation page: text and attributes carry each state, and each
    // outcome is one submit key.
    const org = bare[`/${slug}`];
    expect(org).toContain('<option value="quoted" selected="">Quoted</option>');
    expect(org).toContain('value="2000-01-01"');
    expect(bodyText(org)).toContain('Chase quote on 2000-01-01');
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
  });
});
