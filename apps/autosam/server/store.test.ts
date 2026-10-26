import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, StoreError, versionOf } from './store';

const song = (title: string, extra = '') =>
  `title: ${title}\nkey: C\n${extra}\n[A]\nC | G\n`;

let dir: string;
let seeds: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'autosam-store-'));
  seeds = join(dir, 'seeds');
  await mkdir(seeds);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function rejects(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).status).toBe(status);
    return;
  }
  throw new Error(`expected a ${status} error`);
}

describe('store', () => {
  test('seeds a song once, and an archived seed stays archived', async () => {
    await writeFile(join(seeds, 'one.txt'), song('One'));
    const data = join(dir, 'data');
    let store = createStore(data, seeds);
    await store.init();
    expect((await store.list()).songs.map((s) => s.slug)).toEqual(['one']);
    await store.archive('one');
    store = createStore(data, seeds);
    await store.init();
    const { songs, archived } = await store.list();
    expect(songs).toEqual([]);
    expect(archived.map((s) => s.slug)).toEqual(['one']);
  });

  test('a seed with errors stays out', async () => {
    await writeFile(join(seeds, 'bad.txt'), 'title: Bad\n');
    const store = createStore(join(dir, 'data'), seeds);
    await store.init();
    expect((await store.list()).songs).toEqual([]);
  });

  test('creates, reads, changes and renames a song', async () => {
    const store = createStore(join(dir, 'data'));
    await store.init();
    const made = await store.create(song('My Song'));
    expect(made.slug).toBe('my-song');
    await rejects(store.create(song('My Song')), 409);

    const got = await store.get('my-song');
    expect(got?.version).toBe(versionOf(song('My Song')));

    // A stale version is refused.
    await rejects(
      store.update('my-song', song('My Song', 'tempo: 80'), 'stale'),
      409,
    );
    const changed = await store.update(
      'my-song',
      song('My Song', 'tempo: 80'),
      got?.version,
    );
    expect(changed.slug).toBe('my-song');
    const history = await readdir(join(dir, 'data', 'history', 'my-song'));
    expect(history.length).toBe(1);
    expect(
      await readFile(
        join(dir, 'data', 'history', 'my-song', history[0]),
        'utf8',
      ),
    ).toBe(song('My Song'));

    // A new title moves the song to a new slug.
    const moved = await store.update('my-song', song('Renamed'));
    expect(moved.slug).toBe('renamed');
    expect(await store.get('my-song')).toBeNull();
    expect((await store.get('renamed'))?.title).toBe('Renamed');
  });

  test('refuses a rename onto another song, and a song with errors', async () => {
    const store = createStore(join(dir, 'data'));
    await store.init();
    await store.create(song('One'));
    await store.create(song('Two'));
    await rejects(store.update('two', song('One')), 409);
    await rejects(store.update('two', 'title: Two\n'), 422);
    await rejects(store.create('nonsense'), 422);
  });

  test('archives and restores without losing the text', async () => {
    const store = createStore(join(dir, 'data'));
    await store.init();
    await store.create(song('Keep Me'));
    const { id } = await store.archive('keep-me');
    expect(id).toMatch(/^keep-me--\d{8}T\d{9}Z$/);
    expect(await store.get('keep-me')).toBeNull();
    const { archived } = await store.list();
    expect(archived[0]).toMatchObject({
      id,
      slug: 'keep-me',
      title: 'Keep Me',
    });

    // Restore refuses while another song has the slug.
    await store.create(song('Keep Me'));
    await rejects(store.restore(id), 409);
    await store.archive('keep-me');
    expect((await store.restore(id)).slug).toBe('keep-me');
    expect((await store.get('keep-me'))?.text).toBe(song('Keep Me'));
  });

  test('names no path outside the data folder', async () => {
    const store = createStore(join(dir, 'data'));
    await store.init();
    expect(await store.get('../secret')).toBeNull();
    await rejects(store.archive('../../etc/passwd'), 404);
    await rejects(store.restore('../../x--20260101T000000000Z'), 404);
    await rejects(store.update('..', song('X')), 404);
  });

  test('runs writes one at a time', async () => {
    const store = createStore(join(dir, 'data'));
    await store.init();
    const results = await Promise.allSettled([
      store.create(song('Same')),
      store.create(song('Same')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
  });
});
