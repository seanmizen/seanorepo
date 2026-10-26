import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHandler } from './app';
import { createStore } from './store';

const KEY = 'test-edit-key-123';
const PUBLIC_DIR = resolve(import.meta.dir, '../public');
const SEED_DIR = resolve(import.meta.dir, '../songs');
const NEW = 'title: New Tune\nkey: G\n[A]\nG | D\n';

let dir: string;
let handle: (req: Request) => Promise<Response>;
let clock = 0;

async function setup(editKey = KEY) {
  const store = createStore(join(dir, 'data'), SEED_DIR);
  await store.init();
  handle = await createHandler({
    store,
    publicDir: PUBLIC_DIR,
    editKey,
    now: () => clock,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'autosam-app-'));
  clock = 0;
  await setup();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function call(
  method: string,
  path: string,
  body?: unknown,
  key: string | null = KEY,
  ip = '1.2.3.4',
) {
  const headers: Record<string, string> = { 'cf-connecting-ip': ip };
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return handle(
    new Request(`http://autosam.test${path}`, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : typeof body === 'string'
            ? body
            : JSON.stringify(body),
    }),
  );
}

describe('pages', () => {
  test('the library and a song page are HTML with a CSP', async () => {
    const lib = await call('GET', '/');
    expect(lib.status).toBe(200);
    expect(lib.headers.get('content-security-policy')).toContain(
      "script-src 'self'",
    );
    const page = await call('GET', '/somewhere-only-we-know');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(
      '<title>Somewhere Only We Know · autosam</title>',
    );
  });

  test('an unknown song is a 404 page', async () => {
    const res = await call('GET', '/no-such-song');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('serves the scripts and nothing outside public/', async () => {
    const js = await call('GET', '/app.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect((await call('GET', '/../server/app.ts')).status).toBe(404);
    expect((await call('GET', '/%2e%2e/package.json')).status).toBe(404);
    expect((await call('GET', '/song-format.js')).status).toBe(200);
  });
});

describe('api', () => {
  test('lists and reads songs without a key', async () => {
    const list = await (
      await call('GET', '/api/songs', undefined, null)
    ).json();
    const song = list.songs.find(
      (s: { slug: string }) => s.slug === 'somewhere-only-we-know',
    );
    expect(song).toMatchObject({
      slug: 'somewhere-only-we-know',
      key: 'A',
      tempo: 86,
    });
    const one = await call(
      'GET',
      '/api/songs/somewhere-only-we-know',
      undefined,
      null,
    );
    expect((await one.json()).text).toContain('title: Somewhere Only We Know');
    expect((await call('GET', '/api/songs/nope')).status).toBe(404);
  });

  test('writes need the right key', async () => {
    expect((await call('POST', '/api/songs', { text: NEW }, null)).status).toBe(
      401,
    );
    expect(
      (await call('POST', '/api/songs', { text: NEW }, 'wrong-key-wrong'))
        .status,
    ).toBe(401);
    expect(
      (
        await call(
          'DELETE',
          '/api/songs/somewhere-only-we-know',
          undefined,
          null,
        )
      ).status,
    ).toBe(401);
    expect(
      (await call('POST', '/api/auth/check', undefined, null)).status,
    ).toBe(401);
    expect((await call('POST', '/api/auth/check')).status).toBe(204);
  });

  test('editing is off without a long key', async () => {
    await setup('short');
    expect(
      (await call('POST', '/api/songs', { text: NEW }, 'short')).status,
    ).toBe(503);
    expect((await (await call('GET', '/api/health')).json()).editing).toBe(
      false,
    );
  });

  test('ten wrong keys lock the client out for ten minutes', async () => {
    for (let i = 0; i < 10; i++)
      await call('POST', '/api/auth/check', undefined, 'wrong-key-wrong');
    expect((await call('POST', '/api/auth/check')).status).toBe(429);
    expect(
      (await call('POST', '/api/auth/check', undefined, KEY, '5.6.7.8')).status,
    ).toBe(204);
    clock += 10 * 60 * 1000 + 1;
    expect((await call('POST', '/api/auth/check')).status).toBe(204);
  });

  test('create, change, archive and restore', async () => {
    const made = await call('POST', '/api/songs', { text: NEW });
    expect(made.status).toBe(201);
    expect((await made.json()).slug).toBe('new-tune');

    const got = await (await call('GET', '/api/songs/new-tune')).json();
    const changed = await call('PUT', '/api/songs/new-tune', {
      text: NEW.replace('key: G', 'key: G\ntempo: 70'),
      version: got.version,
    });
    expect(changed.status).toBe(200);
    // The old version is stale now.
    expect(
      (
        await call('PUT', '/api/songs/new-tune', {
          text: NEW,
          version: got.version,
        })
      ).status,
    ).toBe(409);

    const archived = await (await call('DELETE', '/api/songs/new-tune')).json();
    expect((await call('GET', '/api/songs/new-tune')).status).toBe(404);
    const restored = await call('POST', `/api/archive/${archived.id}/restore`);
    expect(await restored.json()).toEqual({ slug: 'new-tune' });
  });

  test('bad bodies get clear errors', async () => {
    expect((await call('POST', '/api/songs', 'not json')).status).toBe(400);
    expect((await call('POST', '/api/songs', { nope: 1 })).status).toBe(400);
    const bad = await call('POST', '/api/songs', {
      text: 'title: x\nkey: Q\n[A]\nC',
    });
    expect(bad.status).toBe(422);
    expect((await bad.json()).details[0]).toContain('"Q" is not a key');
    const big = await call('POST', '/api/songs', {
      text: 'x'.repeat(70 * 1024),
    });
    expect(big.status).toBe(413);
  });
});
