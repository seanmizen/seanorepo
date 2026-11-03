import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from '../index';
import { FE_DIST } from '../render';

describe('GET /', () => {
  test('renders the home page with the health result and the assets', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');

    const html = response.body;
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toContain('<title>crm</title>');
    expect(html).toContain('<h1>crm</h1>');
    expect(html).toContain('<code>{&quot;ok&quot;:true}</code>');

    const manifest = JSON.parse(
      readFileSync(path.join(FE_DIST, 'manifest.json'), 'utf8'),
    );
    const [css] = manifest.entries.main.initial.css;
    const [js] = manifest.entries.main.initial.js;
    expect(html).toContain(`<link rel="stylesheet" href="${css}"/>`);
    expect(html).toContain(`<script src="${js}" defer=""></script>`);

    const asset = await app.inject({ method: 'GET', url: css });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('text/css');
    await app.close();
  });
});
