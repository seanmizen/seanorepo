import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from '../index';
import { FE_DIST } from '../render';

const get = async (url: string) => {
  const app = buildApp();
  const response = await app.inject({ method: 'GET', url });
  await app.close();
  return response;
};

/** The text that a person reads in the `<body>`, with no markup. */
const bodyText = (html: string) =>
  html
    .slice(html.indexOf('<body>'))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('GET /', () => {
  test('renders the home page in the panel layout with the assets', async () => {
    const response = await get('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');

    const html = response.body;
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toContain('<title>Home - crm</title>');
    expect(html).toContain('<header class="plate">');
    expect(html).toContain('<h1>Home</h1>');
    expect(html).toContain('<main class="chassis">');
    expect(html).toContain('<code>{&quot;ok&quot;:true}</code>');
    expect(html).toContain('<span class="led on">OK</span>');

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
});

describe('GET /?theme=bare', () => {
  test('the home page shows each state and allows each action with no page styles and no JavaScript (REQ-CRM-BARE-001)', async () => {
    const themed = (await get('/')).body;
    const bare = (await get('/?theme=bare')).body;

    // No page styles and no scripts.
    expect(bare).not.toContain('<link');
    expect(bare).not.toContain('<style');
    expect(bare).not.toContain(' style="');
    expect(bare).not.toContain('<script');

    // The bare page has all the text of the themed page.
    expect(bodyText(bare)).toBe(bodyText(themed));

    // Text carries the health state. An attribute carries the theme.
    expect(bare).toContain('<span class="led on">OK</span>');
    expect(bare).toContain('<option value="bare" selected="">Bare</option>');
    expect(themed).toContain(
      '<option value="pixel-3" selected="">Pixel-3</option>',
    );

    // The action is a form with a string action and a submit button.
    expect(bare).toContain('<form action="/" method="get">');
    expect(bare).toContain('<button type="submit" class="key">Apply</button>');
  });
});
