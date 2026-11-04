import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { buildApp } from './index';
import { addOrg, divOf, signInAdmin, testApp } from './test-helpers';

/** The source of the theme. */
const THEME = readFileSync(
  path.join(import.meta.dir, '..', '..', 'crm-fe', 'src', 'theme.css'),
  'utf8',
);

/** The one width breakpoint of the layout, in px (REQ-CRM-LAYOUT-002). */
const BREAKPOINT = 960;

/** The one height breakpoint of the layout, in px (REQ-CRM-LAYOUT-002). */
const TALL = 720;

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

describe('the layout (REQ-CRM-LAYOUT-002)', () => {
  test('every width media query in theme.css uses the one breakpoint, each height query uses 720px, and no row of the page wraps (REQ-CRM-LAYOUT-002)', () => {
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
    // A height query is the one height breakpoint.
    const heights = queries.flatMap((query) =>
      [...query.matchAll(/\([^)]*height[^)]*\)/g)].map((match) => match[0]),
    );
    for (const feature of heights) {
      expect(feature).toBe(`(height >= ${TALL}px)`);
    }
    // The comment that names the breakpoint.
    expect(THEME).toContain(`One breakpoint: ${BREAKPOINT}px.`);
    // The control unit is a grid of 12, in fractions. A page on the rack
    // is at most 1680px wide. No flex row wraps at a width that its
    // content or the root font sets.
    expect(THEME).toMatch(
      /\.modules \{[^}]*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\);/,
    );
    expect(THEME).toMatch(
      /body:has\(> main > \.rack\) \{\s*max-width: 1680px;/,
    );
    expect(THEME).not.toMatch(/flex-wrap:\s*wrap/);
  });

  test('the home is the rack over the band: the display unit, then the control unit on a grid of 12, then the band (REQ-CRM-LAYOUT-002)', async () => {
    await addOrg(app, cookie, { name: 'Acme Plumbing' });
    for (const url of ['/', '/orgs']) {
      const html = await get(url);
      const main = html.slice(
        html.indexOf('<main>') + '<main>'.length,
        html.indexOf('</main>'),
      );
      // The rack, then the band, and no part of the old layout.
      const rack = divOf(main, 'rack');
      expect(main.startsWith(rack)).toBe(true);
      expect(main.slice(rack.length)).toMatch(
        /^<section class="band" aria-labelledby="[^"]+">[\s\S]*<\/section>$/,
      );
      expect(html).not.toContain('class="device');
      expect(html).not.toContain('class="body"');
      // The units, each with an ear at each end.
      const ear = '<span class="ear" aria-hidden="true"></span>';
      const display = divOf(rack, 'unit display');
      const controls = divOf(rack, 'unit controls');
      expect(rack).toBe(`<div class="rack">${display}${controls}</div>`);
      for (const unit of [display, controls]) {
        expect(unit).toMatch(/^<div class="unit \w+"><span class="ear"/);
        expect(unit).toEndWith(`${ear}</div>`);
      }
      // The control unit: Search, Stage and Sort. Their spans fill the
      // grid of 12.
      const spans = [
        ...controls.matchAll(
          /<section id="(\w+)" class="module(?: span-(\d+))?">/g,
        ),
      ].map((match) => [match[1], Number(match[2] ?? 6)]);
      expect(spans).toEqual([
        ['search', 3],
        ['stage', 6],
        ['sort', 3],
      ]);
    }
  });

  test('the organisation page and its edit pages are the rack: the display unit of the record, then the control unit, then the bands (REQ-CRM-LAYOUT-002)', async () => {
    const slug = await addOrg(app, cookie, {
      name: 'Acme Plumbing',
      contact_name: 'Ann Smith',
    });
    for (const url of [
      `/orgs/${slug}`,
      `/orgs/${slug}/edit`,
      `/orgs/${slug}/contacts/1`,
    ]) {
      const html = await get(url);
      expect(html).not.toContain('class="device');
      expect(html).not.toContain('class="body"');
      const main = html.slice(
        html.indexOf('<main>') + '<main>'.length,
        html.indexOf('</main>'),
      );
      const rack = divOf(main, 'rack');
      const display = divOf(rack, 'unit display');
      const controls = divOf(rack, 'unit controls');
      expect(rack).toBe(`<div class="rack">${display}${controls}</div>`);
      // The edit pages have an intro before the rack.
      expect(main.replace(/^<p class="intro">[^<]*<\/p>/, '')).toStartWith(
        rack,
      );
    }
    // The organisation page: Contacts (8 of 12) and Details (4), then
    // Activity, under the rack.
    const html = await get(`/orgs/${slug}`);
    const bands = divOf(html, 'bands');
    expect(
      [
        ...bands.matchAll(/<section class="band ([\w -]+)" aria-labelledby/g),
      ].map((match) => match[1]),
    ).toEqual(['contacts span-8', 'details span-4', 'activity']);
    expect(THEME).toMatch(/\.bands \{[^}]*grid-template-columns: repeat\(12/);
  });

  test('a page with a device keeps the 40/60 grid: the left column holds only the device, and each section of data is a Box (REQ-CRM-LAYOUT-002)', async () => {
    // The wide grid is 40% and 60%, in fractions.
    expect(THEME).toContain(
      'grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);',
    );
    const pages: Record<string, string[]> = {
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

  test('the nav links are in the HTML once, under the path title (REQ-CRM-LAYOUT-002)', async () => {
    const html = await get('/');
    expect(html.match(/<nav class="links"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<body><h1 id="top" class="title">.*?<\/h1><nav class="links"/,
    );
    // On a wide screen, the theme moves them to the footer row.
    expect(THEME).toMatch(
      /@media \(width >= 960px\) \{\s*body > \.links \{\s*order: 1;/,
    );
    // On a narrow screen too, on a page with the mode keys.
    expect(html).toContain('<nav class="plate-row modes" aria-label="Mode">');
    expect(THEME).toMatch(
      /body:has\(\.plate > \.modes\) > \.links \{\s*order: 1;/,
    );
  });
});
