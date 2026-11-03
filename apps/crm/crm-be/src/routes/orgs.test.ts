import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { buildApp } from '../index';
import { addOrg, postForm, signInAdmin, testApp } from '../test-helpers';

let app: ReturnType<typeof buildApp>;
let close: () => Promise<void>;
let cookie: string;

beforeEach(async () => {
  ({ app, close } = testApp());
  cookie = signInAdmin(app);
  await addOrg(app, cookie, { name: 'Zed Bakery', postcode: 'sw1a 1aa' });
  const slug = await addOrg(app, cookie, {
    name: 'Acme Plumbing',
    postcode: 'E1 6AN',
  });
  await postForm(app, `/${slug}/stage`, { stage: 'quoted' }, cookie);
  await addOrg(app, cookie, { name: '100% Cotton' });
});

afterEach(async () => {
  await close();
});

/** The names in the result table, in order. */
const names = async (url: string) => {
  const response = await app.inject({
    method: 'GET',
    url,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return [
    ...response.body.matchAll(
      /<th scope="row"><a href="\/[^"]+">([^<]+)<\/a>/g,
    ),
  ].map((m) => m[1]);
};

describe('GET /orgs', () => {
  test('lists all organisations by name, with a GET search form', async () => {
    expect(await names('/orgs')).toEqual([
      '100% Cotton',
      'Acme Plumbing',
      'Zed Bakery',
    ]);
    const html = (
      await app.inject({ method: 'GET', url: '/orgs', headers: { cookie } })
    ).body;
    expect(html).toContain('<form action="/orgs" method="get">');
    expect(html).toContain('3 organisations.');
  });

  test('searches the name, with no regard to case', async () => {
    expect(await names('/orgs?q=ACME')).toEqual(['Acme Plumbing']);
  });

  test('searches the postcode, with no regard to case or spaces', async () => {
    expect(await names('/orgs?q=SW1A1AA')).toEqual(['Zed Bakery']);
    expect(await names('/orgs?q=e1%206')).toEqual(['Acme Plumbing']);
  });

  test('a % in the search matches only a %', async () => {
    expect(await names('/orgs?q=%25')).toEqual(['100% Cotton']);
  });

  test('filters by stage, and ignores a stage that does not exist', async () => {
    expect(await names('/orgs?stage=quoted')).toEqual(['Acme Plumbing']);
    expect(await names('/orgs?stage=lead')).toEqual([
      '100% Cotton',
      'Zed Bakery',
    ]);
    expect(await names('/orgs?stage=nope')).toHaveLength(3);
    expect(await names('/orgs?q=zed&stage=quoted')).toEqual([]);
  });
});
