import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SESSION_COOKIE } from '../auth';
import {
  ICO_REGISTRATION,
  PRIVACY_EMAIL,
  PRIVACY_UPDATED,
} from '../content/privacy';
import { formatDate } from '../dates';
import { DEMO_TEXT } from '../demo';
import type { buildApp } from '../index';
import {
  addOrg,
  bodyText,
  signIn,
  signInAdmin,
  testApp,
} from '../test-helpers';
import { HOME_HEADING } from './index';
import { DEMO_PRIVACY_TEXT } from './privacy';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let admin: string;
const savedDemo = process.env.CRM_UNSAFE_DEMO_LOGIN;

beforeEach(() => {
  ({ app, db, close } = testApp());
  admin = signInAdmin(app);
});

afterEach(async () => {
  await close();
  if (savedDemo === undefined) delete process.env.CRM_UNSAFE_DEMO_LOGIN;
  else process.env.CRM_UNSAFE_DEMO_LOGIN = savedDemo;
});

/** GET `url`, signed out, or as the person of `cookie`. */
const get = (url: string, cookie?: string) =>
  app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

/** The section titles of the notice, in order (the ICO order). */
const SECTIONS = [
  'Who I am',
  'The data I keep',
  'Why I keep it',
  'Who receives it',
  'Transfers outside the UK',
  'How long I keep it',
  'Your rights',
  'Complaints',
  'Cookies',
  'Changes',
];

const sectionTitles = (html: string) =>
  [...html.matchAll(/<section class="box"><h2 class="label">([^<]+)/g)].map(
    (match) => match[1],
  );

describe('GET / signed out', () => {
  test('shows the public home: the path title, the heading and two links, and no client data', async () => {
    const slug = await addOrg(app, admin, {
      name: 'Acme Plumbing',
      postcode: 'SW1A 1AA',
      contact_name: 'Ann Smith',
    });
    for (const url of ['/', '/?q=acme&stage=lead&sort=name&dir=desc']) {
      const page = await get(url);
      expect(page.statusCode).toBe(200);
      expect(page.headers.location).toBeUndefined();
      expect(page.cookies).toEqual([]);
      const html = page.body;
      expect(html).toContain('<title>Client portal - crm</title>');
      expect(html).toContain(
        '<body><h1 id="top" class="title"><span aria-current="page">crm</span></h1><main>',
      );
      expect(html).toContain(
        `<section class="box"><h2 class="label">${HOME_HEADING}</h2><ul><li><a href="/login">Sign in</a></li><li><a href="/privacy">Privacy notice</a></li></ul></section>`,
      );
      // Nothing else: no app links, no form and no data.
      expect(bodyText(html)).toBe(
        `crm ${HOME_HEADING} Sign in Privacy notice privacy top`,
      );
      expect(html).not.toContain('<form');
      expect(html).not.toContain('Acme');
      expect(html).not.toContain('Ann Smith');
      expect(html).not.toContain('SW1A');
      expect(html).not.toContain(slug);
    }
  });

  test('works as raw HTML (REQ-CRM-BARE-001)', async () => {
    const themed = (await get('/')).body;
    const bare = (await get('/?theme=bare')).body;
    expect(bare).not.toContain('<link');
    expect(bare).not.toContain('<script');
    expect(bodyText(bare)).toBe(bodyText(themed));
  });

  test('signed in, / is still the list, and /orgs still needs a session', async () => {
    await addOrg(app, admin, { name: 'Acme Plumbing' });
    for (const url of ['/', '/orgs']) {
      const page = await get(url, admin);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>Organisations - crm</title>');
      expect(page.body).toContain('Acme Plumbing');
      expect(page.body).not.toContain(HOME_HEADING);
    }
    // A client gets the admin-only page at /, not the public home.
    const client = await signIn(app, db, 'client@example.com');
    const page = await get('/', client);
    expect(page.statusCode).toBe(403);
    expect(page.body).not.toContain(HOME_HEADING);
    expect(page.body).not.toContain('Acme Plumbing');

    const orgs = await get('/orgs');
    expect(orgs.statusCode).toBe(303);
    expect(orgs.headers.location).toBe('/login?next=%2Forgs');
  });
});

describe('GET /privacy', () => {
  test('is open signed out and signed in, and shows the date and each section in order', async () => {
    for (const cookie of [undefined, admin]) {
      const page = await get('/privacy', cookie);
      expect(page.statusCode).toBe(200);
      expect(page.headers.location).toBeUndefined();
      expect(page.cookies).toEqual([]);
      const html = page.body;
      expect(html).toContain('<title>Privacy notice - crm</title>');
      // The date of the last change, in the one format (REQ-CRM-DATE-001).
      expect(html).toMatch(
        new RegExp(
          `<p class="intro">Last updated <time dateTime="${PRIVACY_UPDATED}T00:00:00[+-]\\d\\d:\\d\\d" title="[^"]+">${formatDate(PRIVACY_UPDATED)}</time>.</p>`,
        ),
      );
      expect(sectionTitles(html)).toEqual(SECTIONS);
      const text = bodyText(html);
      expect(text).toContain('Sean Mizen, sole trader');
      expect(text).toContain(ICO_REGISTRATION);
      expect(html).toContain(
        `<a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a>`,
      );
      expect(html).toContain('<a href="https://ico.org.uk/make-a-complaint/">');
      for (const name of ['Stripe', 'Cloudflare', 'Google', 'Anthropic']) {
        expect(text).toContain(name);
      }
      expect(text).toContain(SESSION_COOKIE);
      expect(text).not.toContain(DEMO_PRIVACY_TEXT);
    }
  });

  test('works as raw HTML (REQ-CRM-BARE-001)', async () => {
    const themed = (await get('/privacy')).body;
    const bare = (await get('/privacy?theme=bare')).body;
    expect(bare).not.toContain('<link');
    expect(bare).not.toContain('<style');
    expect(bare).not.toContain('<script');
    expect(bodyText(bare)).toBe(bodyText(themed));
    expect(sectionTitles(bare)).toEqual(SECTIONS);
  });

  test('the demo shows the same notice and one line that the demo data is fictional', async () => {
    const live = (await get('/privacy')).body;
    process.env.CRM_UNSAFE_DEMO_LOGIN = 'true';
    const demo = (await get('/privacy')).body;
    expect(demo).toContain(`<p class="demo">${DEMO_TEXT}</p>`);
    expect(demo).toContain(`<div class="help"><p>${DEMO_PRIVACY_TEXT}</p>`);
    expect(divOfBoxes(demo)).toBe(divOfBoxes(live));
  });
});

/** The boxes of a page: the notice itself. */
const divOfBoxes = (html: string) =>
  html.slice(html.indexOf('<div class="boxes">'), html.indexOf('</main>'));

describe('the footer', () => {
  test('every page has the privacy link, signed in or not', async () => {
    const link = '<a href="/privacy">privacy</a>';
    for (const url of ['/', '/login', '/login/code', '/privacy']) {
      expect((await get(url)).body.split('<footer')[1] ?? '').toContain(link);
    }
    for (const url of ['/', '/orgs', '/account', '/privacy', '/orgs/nobody']) {
      const page = await get(url, admin);
      expect(page.body.split('<footer')[1]).toContain(link);
    }
  });
});
