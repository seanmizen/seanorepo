import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { buildApp } from './index';
import { addOrg, divOf, postForm, signInAdmin, testApp } from './test-helpers';

/** The source of the theme. */
const THEME = readFileSync(
  path.join(import.meta.dir, '..', '..', 'crm-fe', 'src', 'theme.css'),
  'utf8',
);

/** The one breakpoint of the layout, in px (REQ-CRM-LAYOUT-001). */
const BREAKPOINT = 960;

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

/** GET `url` as the admin. */
const get = async (url: string) =>
  (await app.inject({ method: 'GET', url, headers: { cookie } })).body;

describe('the layout (REQ-CRM-LAYOUT-001)', () => {
  test('every width media query in theme.css uses the one breakpoint, and no row of the page wraps (REQ-CRM-LAYOUT-001)', () => {
    const queries = [...THEME.matchAll(/@media([^{]+)\{/g)].map((match) =>
      match[1].trim(),
    );
    const widths = queries.flatMap((query) =>
      [...query.matchAll(/\([^)]*width[^)]*\)/g)].map((match) => match[0]),
    );
    // A narrow query and a wide query, at least.
    expect(widths).toContain(`(width < ${BREAKPOINT}px)`);
    expect(widths).toContain(`(width >= ${BREAKPOINT}px)`);
    for (const feature of widths) {
      expect([
        `(width < ${BREAKPOINT}px)`,
        `(width >= ${BREAKPOINT}px)`,
      ]).toContain(feature);
    }
    // The comment that names the breakpoint.
    expect(THEME).toContain(`One breakpoint: ${BREAKPOINT}px.`);
    // The wide grid is 40% and 60%, in fractions. No flex row wraps at a
    // width that its content or the root font sets.
    expect(THEME).toContain(
      'grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);',
    );
    expect(THEME).not.toMatch(/flex-wrap:\s*wrap/);
  });

  test('the left column holds only the device, and each section of data is a Box in the right column (REQ-CRM-LAYOUT-001)', async () => {
    const slug = await addOrg(app, cookie, {
      name: 'Acme Plumbing',
      contact_name: 'Ann Smith',
    });
    await postForm(
      app,
      `/orgs/${slug}/activity`,
      { outcome: 'spoke', note: 'Wants a site' },
      cookie,
    );
    const pages: Record<string, string[]> = {
      [`/orgs/${slug}`]: ['Activity', 'Contacts', 'Details'],
      '/account/passkeys': ['Passkeys'],
      '/account/sessions': ['Sessions'],
    };
    for (const [url, titles] of Object.entries(pages)) {
      const html = await get(url);
      const device = divOf(html, 'device');
      if (device) {
        expect(divOf(html, 'device-col')).toBe(
          `<div class="device-col">${device}</div>`,
        );
      }
      const boxes = divOf(html, 'boxes');
      expect(divOf(html, 'data-col')).toContain(boxes);
      expect(boxes).toMatch(
        /^<div class="boxes">(<section class="box"><h2 class="label">[^<]+<\/h2>[\s\S]*?<\/section>)+<\/div>$/,
      );
      expect(
        [...boxes.matchAll(/<section class="box"><h2 class="label">([^<]+)/g)]
          .map((match) => match[1])
          .join(', '),
      ).toBe(titles.join(', '));
    }
  });

  test('the nav links are in the HTML once, under the path title (REQ-CRM-LAYOUT-001)', async () => {
    const html = await get('/');
    expect(html.match(/<nav class="links"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<body><h1 id="top" class="title">.*?<\/h1><nav class="links"/,
    );
    // On a wide screen, the theme moves them to the footer row.
    expect(THEME).toMatch(
      /@media \(width >= 960px\) \{\s*body > \.links \{\s*order: 1;/,
    );
  });
});
