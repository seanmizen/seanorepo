import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { addDays, today } from '../dates';
import type { buildApp } from '../index';
import {
  addOrg,
  bodyText,
  divOf,
  postForm,
  signInAdmin,
  testApp,
} from '../test-helpers';
import { orderSearch, parseOrder } from './index';

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

const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: { cookie } });

const post = (url: string, fields: Record<string, string>) =>
  postForm(app, url, fields, cookie);

/** Add an organisation at `stage`, with a next action due in `days`. */
const addDue = async (name: string, days: number | null, stage = 'lead') => {
  const slug = await addOrg(app, cookie, { name });
  await post(`/orgs/${slug}/stage`, {
    stage,
    next_action: days === null ? '' : 'Call',
    next_action_on: days === null ? '' : addDays(today(), days),
  });
  return slug;
};

/** The links of the band rows, in order. */
const rowLinks = (html: string) =>
  [
    ...html.matchAll(/<th scope="row" class="c-name"[^>]*><a href="([^"]+)"/g),
  ].map((match) => match[1].replaceAll('&amp;', '&'));

/** A plate key of a page: its href, or `off` and its caption. */
const plateKey = (html: string, id: string) => {
  const link = new RegExp(`<a class="key[^"]*" id="${id}" href="([^"]+)"`).exec(
    html,
  )?.[1];
  const caption = new RegExp(
    `<span class="caption" id="${id}-caption">([^<]*)</span>`,
  ).exec(html)?.[1];
  return link
    ? { href: link.replaceAll('&amp;', '&'), caption }
    : {
        off: new RegExp(`id="${id}"[^>]*disabled=""`).test(html),
        caption,
      };
};

describe('the running order (apps/crm/docs/002-rack.md)', () => {
  test('each row link of a list carries the list query and its place, and the org page reads its neighbours in that order', async () => {
    await addDue('Alpha', -2);
    await addDue('Bravo', -1);
    await addDue('Charlie', 3);
    // The Plan with no query: the default order, due first.
    expect(rowLinks((await get('/')).body)).toEqual([
      '/orgs/alpha?at=1',
      '/orgs/bravo?at=2',
      '/orgs/charlie?at=3',
    ]);
    // The address book, Z to A: a short query string, with no UUID.
    const book = rowLinks((await get('/orgs?sort=name&dir=desc')).body);
    expect(book).toEqual([
      '/orgs/charlie?list=orgs&sort=name&dir=desc&at=1',
      '/orgs/bravo?list=orgs&sort=name&dir=desc&at=2',
      '/orgs/alpha?list=orgs&sort=name&dir=desc&at=3',
    ]);
    const middle = (await get(book[1])).body;
    expect(plateKey(middle, 'walk-prev')).toEqual({
      href: book[0],
      caption: 'Charlie',
    });
    expect(plateKey(middle, 'walk-next')).toEqual({
      href: book[2],
      caption: 'Alpha',
    });
    // At the ends the keys are off, with the reason (REQ-CRM-BUTTON-001).
    const first = (await get(book[0])).body;
    expect(plateKey(first, 'walk-prev')).toEqual({
      off: true,
      caption: 'First in list',
    });
    const last = (await get(book[2])).body;
    expect(plateKey(last, 'walk-next')).toEqual({
      off: true,
      caption: 'Last in list',
    });
    // An org page with no query walks the Plan.
    const plain = (await get('/orgs/bravo')).body;
    expect(plateKey(plain, 'walk-prev').href).toBe('/orgs/alpha?at=1');
    expect(plateKey(plain, 'walk-next').href).toBe('/orgs/charlie?at=3');
  });

  test('Start opens the first org of the list, and is off with its reason when the list is empty', async () => {
    await addDue('Alpha', -2);
    await addDue('Bravo', null, 'visited');
    expect(plateKey((await get('/?stage=visited')).body, 'start')).toEqual({
      href: '/orgs/bravo?stage=visited&at=1',
      caption: 'Bravo',
    });
    expect(plateKey((await get('/orgs')).body, 'start')).toEqual({
      href: '/orgs/alpha?list=orgs&at=1',
      caption: 'Alpha',
    });
    expect(plateKey((await get('/?q=zzz')).body, 'start')).toEqual({
      off: true,
      caption: 'No match',
    });
  });

  test('each form of the org page posts with the running order, and the redirect keeps it', async () => {
    await addDue('Alpha', -2);
    const search = '?stage=lead&at=1';
    const html = (await get(`/orgs/alpha${search}`)).body;
    for (const action of [
      '/orgs/alpha/activity',
      '/orgs/alpha/stage',
      '/orgs/alpha/contacts',
    ]) {
      expect(html).toContain(
        `action="${action}${search.replace('&', '&amp;')}${action.endsWith('contacts') ? '' : '#next'}"`,
      );
    }
    const saved = await post(`/orgs/alpha/activity${search}`, {
      outcome: 'spoke',
      note: '',
    });
    expect(saved.headers.location).toBe(`/orgs/alpha${search}`);
    // The Show hidden form is a GET form: it sends the order as fields.
    expect(html).toContain('<input type="hidden" name="stage" value="lead"/>');
    expect(html).toContain('<input type="hidden" name="at" value="1"/>');
  });

  test('a save that moves the org in the list, or out of it, keeps Prev and Next on its old neighbours', async () => {
    await addDue('Alpha', -3);
    await addDue('Bravo', -2);
    await addDue('Charlie', -1);
    // Bravo moves to the end of the Plan: due in a week.
    await post('/orgs/bravo/stage?at=2', {
      stage: 'lead',
      next_action: 'Call',
      next_action_on: addDays(today(), 7),
    });
    let html = (await get('/orgs/bravo?at=2')).body;
    expect(plateKey(html, 'walk-prev').href).toBe('/orgs/alpha?at=1');
    expect(plateKey(html, 'walk-next').href).toBe('/orgs/charlie?at=2');
    // Charlie moves to the start of the Plan.
    await post('/orgs/charlie/stage?at=3', {
      stage: 'lead',
      next_action: 'Call',
      next_action_on: addDays(today(), -9),
    });
    html = (await get('/orgs/charlie?at=3')).body;
    expect(plateKey(html, 'walk-prev').href).toBe('/orgs/bravo?at=3');
    expect(plateKey(html, 'walk-next')).toEqual({
      off: true,
      caption: 'Last in list',
    });
    // Alpha leaves a list of leads: Next still opens the org after it.
    const leads = rowLinks((await get('/?stage=lead')).body);
    expect(leads[1]).toBe('/orgs/alpha?stage=lead&at=2');
    await post('/orgs/alpha/stage?stage=lead&at=2', { stage: 'lost' });
    html = (await get('/orgs/alpha?stage=lead&at=2')).body;
    expect(plateKey(html, 'walk-prev').href).toBe(
      '/orgs/charlie?stage=lead&at=1',
    );
    expect(plateKey(html, 'walk-next').href).toBe(
      '/orgs/bravo?stage=lead&at=2',
    );
    expect(plateKey(html, 'mode-work').caption).toBe('Not in list');
  });

  test('a running order reads only valid values, and writes no empty parameter', () => {
    const order = parseOrder({
      list: 'nope',
      q: 'bake',
      stage: 'bogus',
      sort: 'evil',
      dir: 'sideways',
      at: '-4',
      page: '3',
    });
    expect(order).toEqual({
      path: '/',
      query: { q: 'bake', stage: '', sort: 'due', dir: 'asc', page: 1 },
      at: null,
    });
    expect(orderSearch(order)).toBe('?q=bake');
    expect(orderSearch(parseOrder({}))).toBe('');
    expect(orderSearch(parseOrder({ list: 'orgs', at: '2' }))).toBe(
      '?list=orgs&at=2',
    );
  });
});

describe('the mode keys (apps/crm/docs/002-rack.md, decision 1)', () => {
  test('Plan, Work and Review are latching links on the plate, with the key of the mode of the page on', async () => {
    await addDue('Alpha', -2);
    const on = async (url: string) => {
      const modes = (await get(url)).body.match(
        /<nav class="plate-row modes" aria-label="Mode">[\s\S]*?<\/nav>/,
      )?.[0];
      expect(modes).toBeDefined();
      expect(
        [...(modes ?? '').matchAll(/<a class="key latch" id="mode-(\w+)"/g)]
          .map((match) => match[1])
          .join(' '),
      ).toBe('plan work review');
      return [...(modes ?? '').matchAll(/id="mode-(\w+)"[^>]*aria-current/g)]
        .map((match) => match[1])
        .join(' ');
    };
    expect(await on('/')).toBe('plan');
    expect(await on('/orgs/alpha')).toBe('work');
    expect(await on('/review')).toBe('review');
    // The address book is in no mode.
    expect(await on('/orgs')).toBe('');
    // With no page styles, the key that is on says so.
    expect(bodyText((await get('/')).body)).toContain('Plan (current) 1 due');
    const home = (await get('/')).body;
    expect(plateKey(home, 'mode-work')).toEqual({
      href: '/orgs/alpha?at=1',
      caption: '1 in list',
    });
    expect(plateKey((await get('/orgs/alpha')).body, 'mode-work').caption).toBe(
      '1 of 1',
    );
  });
});

describe('GET /review', () => {
  test('lists the visits and notes logged today, newest first, and what is still due', async () => {
    await addDue('Alpha', -2);
    await addDue('Bravo', 0);
    await addDue('Charlie', 4);
    await post('/orgs/charlie/activity', { outcome: 'spoke', note: 'Keen' });
    await post('/orgs/alpha/activity', { outcome: 'note', note: 'Closed' });
    // A visit of yesterday does not count.
    db.query("UPDATE visit SET at = '2000-01-01T10:00:00.000Z';").run();
    await post('/orgs/bravo/activity', { outcome: 'no_answer', note: '' });
    const html = (await get('/review')).body;
    const logged = html.slice(
      html.indexOf('aria-labelledby="logged"'),
      html.indexOf('aria-labelledby="still-due"'),
    );
    expect(rowLinks(logged)).toEqual(['/orgs/bravo', '/orgs/alpha']);
    expect(bodyText(`<body>${logged}`)).toContain('Visit 1 · No answer');
    expect(bodyText(`<body>${logged}`)).toContain('Note 1 Closed');
    const due = html.slice(html.indexOf('aria-labelledby="still-due"'));
    expect(rowLinks(due)).toEqual(['/orgs/alpha?at=1', '/orgs/bravo?at=2']);
    const glass = bodyText(`<body>${divOf(html, 'glass')}`);
    expect(glass).toContain('1 visit, 1 note');
    expect(glass).toContain('Overdue 1');
    expect(glass).toContain('Due today 1');
    expect(plateKey(html, 'mode-review').caption).toBe('2 logged');
  });
});
