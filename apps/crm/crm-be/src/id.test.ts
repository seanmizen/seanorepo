import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { seedDemo } from './demo-seed';
import type { buildApp } from './index';
import {
  bodyText,
  postForm,
  signInAdmin,
  TEST_ADMIN_EMAIL,
  testApp,
} from './test-helpers';

/** A UUID, in any case. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let cookie: string;

beforeEach(() => {
  ({ app, db, close } = testApp());
  seedDemo(db, TEST_ADMIN_EMAIL);
  cookie = signInAdmin(app);
});

afterEach(async () => {
  await close();
});

/** Each `href` and `action` of `html`. */
const urlsOf = (html: string) =>
  [...html.matchAll(/\s(?:href|action)="([^"]*)"/g)].map((match) => match[1]);

describe('short IDs (REQ-CRM-ID-001)', () => {
  test('no page of a seeded organisation has a UUID in a URL (href, action, Location) or in the visible text', async () => {
    // Open /orgs, then each link under /orgs on each page, once.
    const queue = ['/orgs'];
    const seen = new Set(queue);
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { cookie },
      });
      // The path title links `/orgs/<slug>/contacts` and `.../activity`,
      // which redirect to the organisation page.
      if (response.statusCode === 303) {
        expect(String(response.headers.location)).not.toMatch(UUID);
        continue;
      }
      if (response.statusCode !== 200) {
        throw new Error(`GET ${url} returned ${response.statusCode}.`);
      }
      const html = response.body;
      for (const link of urlsOf(html)) expect(link).not.toMatch(UUID);
      expect(bodyText(html)).not.toMatch(UUID);
      // The pages of the organisations have no UUID in any attribute too.
      expect(html).not.toMatch(UUID);
      for (const [, link] of html.matchAll(/\shref="([^"]*)"/g)) {
        const path = link.replace(/[?#].*$/, '');
        if (path.startsWith('/orgs/') && !seen.has(path)) {
          seen.add(path);
          queue.push(path);
        }
      }
    }
    const pages = [...seen];
    const slugs = db
      .query<{ slug: string }, []>('SELECT slug FROM organisation;')
      .all()
      .map((row) => row.slug);
    expect(slugs).toHaveLength(10);
    for (const slug of slugs) {
      expect(pages).toContain(`/orgs/${slug}`);
      expect(pages).toContain(`/orgs/${slug}/edit`);
    }
    expect(pages).toContain('/orgs/the-example-bakery/contacts/1');
    expect(pages).toContain('/orgs/the-example-bakery/activity/3');
    // Each visit and note has its edit page, and each contact has its own.
    const count = (sql: string) =>
      db.query<{ n: number }, []>(sql).get()?.n ?? 0;
    expect(pages.filter((page) => /\/activity\/\d+$/.test(page))).toHaveLength(
      count(
        'SELECT (SELECT count(*) FROM visit) + (SELECT count(*) FROM note) AS n;',
      ),
    );
    expect(pages.filter((page) => /\/contacts\/\d+$/.test(page))).toHaveLength(
      count('SELECT count(*) AS n FROM membership;'),
    );

    // Each POST of an organisation page redirects with no UUID.
    const posts: [string, Record<string, string>][] = [
      ['/orgs/new', { name: 'New Org', contact_name: 'Nia' }],
      ['/orgs/the-example-bakery/activity', { outcome: 'spoke', note: 'x' }],
      [
        '/orgs/the-example-bakery/activity/1',
        { outcome: 'call_back', note: 'y' },
      ],
      ['/orgs/the-example-bakery/contacts', { name: 'Bo', role: 'staff' }],
      ['/orgs/the-example-bakery/contacts/1', { name: 'Al', role: 'owner' }],
      ['/orgs/sample-and-sons-hardware/contacts/2/remove', {}],
      ['/orgs/the-example-bakery/stage', { stage: 'won' }],
      [
        '/orgs/the-example-bakery/edit',
        { name: 'The Example Bakery', slug: 'the-example-bakery' },
      ],
    ];
    for (const [url, fields] of posts) {
      const response = await postForm(app, url, fields, cookie);
      expect(`${url} ${response.statusCode}`).toBe(`${url} 303`);
      expect(String(response.headers.location)).toMatch(/^\/orgs\/[a-z0-9-]+$/);
    }
  });

  test('the path title of an edit page shows the number', async () => {
    for (const [url, title] of [
      [
        '/orgs/the-example-bakery/contacts/1',
        'crm / orgs / the-example-bakery / contacts / 1',
      ],
      [
        '/orgs/the-example-bakery/activity/3',
        'crm / orgs / the-example-bakery / activity / 3',
      ],
    ]) {
      const html = (
        await app.inject({ method: 'GET', url, headers: { cookie } })
      ).body;
      const h1 = html.slice(html.indexOf('<h1'), html.indexOf('</h1>'));
      expect(bodyText(`<body>${h1}`)).toBe(title);
    }
  });

  test('the Activity list shows the number of each visit and note', async () => {
    const html = (
      await app.inject({
        method: 'GET',
        url: '/orgs/the-example-bakery',
        headers: { cookie },
      })
    ).body;
    const text = bodyText(html);
    expect(text).toContain('Visit 1: No answer. Closed for a delivery. Edit');
    expect(text).toContain('Visit 2: Spoke. Owner wants');
    expect(text).toContain('Note 3: Sent a price');
    expect(html).toContain(
      '<a class="edit" href="/orgs/the-example-bakery/activity/2">',
    );
  });
});
