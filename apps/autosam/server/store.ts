// Where: apps/autosam/server/store.ts
// Why: keeps the songs as text files in the data folder (a named Docker
// volume in production).
//
//   songs/<slug>.txt              the songs in the library
//   archive/<slug>--<stamp>.txt   archived songs. An archive never deletes.
//   history/<slug>/<stamp>.txt    the old text of each changed song
//   seeded.json                   the seed files that init() copied once
//
// Each file name comes from a slug that matches SLUG_RE, or from an archive
// id that matches ARCHIVE_ID_RE. So no request can name a path outside the
// data folder. One queue runs the writes one at a time.

import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { parseSong, SLUG_RE } from '../public/song-format.js';

export const MAX_SONGS = 500;
export const ARCHIVE_ID_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)--(\d{8}T\d{9}Z)$/;

export class StoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export type SongSummary = {
  slug: string;
  title: string;
  artist: string;
  key: string;
  tempo: number;
  updatedAt: string;
};

export type ArchivedSummary = {
  id: string;
  slug: string;
  title: string;
  artist: string;
  archivedAt: string;
};

export type Song = {
  slug: string;
  title: string;
  text: string;
  version: string;
};

export const versionOf = (text: string) =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

// 2026-10-24T17:40:12.345Z -> 20261024T174012345Z. Sorts as text.
const stamp = (d = new Date()) => d.toISOString().replace(/[-:.]/g, '');

const isMissing = (e: unknown) =>
  (e as NodeJS.ErrnoException)?.code === 'ENOENT';

function validate(text: string) {
  const song = parseSong(text);
  if (song.errors.length)
    throw new StoreError(422, 'The song has errors.', song.errors);
  return song;
}

export function createStore(dataDir: string, seedDir?: string) {
  const songsDir = join(dataDir, 'songs');
  const archiveDir = join(dataDir, 'archive');
  const historyDir = join(dataDir, 'history');
  const songFile = (slug: string) => {
    if (!SLUG_RE.test(slug))
      throw new StoreError(404, 'There is no such song.');
    return join(songsDir, `${slug}.txt`);
  };

  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  // Write to a temporary file, then rename it. A crash never leaves half
  // a song.
  async function writeAtomic(path: string, text: string) {
    const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
  }

  async function readSong(slug: string): Promise<string | null> {
    try {
      return await readFile(songFile(slug), 'utf8');
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async function exists(slug: string) {
    return (await readSong(slug)) !== null;
  }

  async function slugs() {
    const names = await readdir(songsDir);
    return names
      .filter((n) => n.endsWith('.txt'))
      .map((n) => n.slice(0, -4))
      .filter((s) => SLUG_RE.test(s));
  }

  async function init() {
    await mkdir(songsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
    await mkdir(historyDir, { recursive: true });
    if (!seedDir) return;
    // A seed file goes in once. A song that someone archived later does
    // not come back at the next start.
    const seededPath = join(dataDir, 'seeded.json');
    let seeded: string[] = [];
    try {
      seeded = JSON.parse(await readFile(seededPath, 'utf8'));
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
    let names: string[] = [];
    try {
      names = (await readdir(seedDir)).filter((n) => n.endsWith('.txt')).sort();
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
    for (const name of names) {
      if (seeded.includes(name)) continue;
      const text = await readFile(join(seedDir, name), 'utf8');
      const song = parseSong(text);
      if (song.errors.length) {
        console.error(
          `autosam: seed ${name} has errors. It stays out.`,
          song.errors,
        );
        continue;
      }
      if (!(await exists(song.slug)))
        await writeAtomic(songFile(song.slug), text);
      seeded.push(name);
    }
    await writeAtomic(seededPath, `${JSON.stringify(seeded, null, 2)}\n`);
  }

  async function list(): Promise<{
    songs: SongSummary[];
    archived: ArchivedSummary[];
  }> {
    const songs: SongSummary[] = [];
    for (const slug of await slugs()) {
      const text = await readSong(slug);
      if (text === null) continue;
      const { meta } = parseSong(text);
      const { mtime } = await stat(songFile(slug));
      songs.push({
        slug,
        title: meta.title || slug,
        artist: meta.artist,
        key: meta.keyText,
        tempo: meta.tempo,
        updatedAt: mtime.toISOString(),
      });
    }
    songs.sort((a, b) => a.title.localeCompare(b.title));

    const archived: ArchivedSummary[] = [];
    for (const name of await readdir(archiveDir)) {
      const m = ARCHIVE_ID_RE.exec(name.replace(/\.txt$/, ''));
      if (!m || !name.endsWith('.txt')) continue;
      const { meta } = parseSong(
        await readFile(join(archiveDir, name), 'utf8'),
      );
      const s = m[2];
      archived.push({
        id: `${m[1]}--${s}`,
        slug: m[1],
        title: meta.title || m[1],
        artist: meta.artist,
        archivedAt: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.${s.slice(15, 18)}Z`,
      });
    }
    archived.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
    return { songs, archived };
  }

  async function get(slug: string): Promise<Song | null> {
    if (!SLUG_RE.test(slug)) return null;
    const text = await readSong(slug);
    if (text === null) return null;
    return {
      slug,
      title: parseSong(text).meta.title,
      text,
      version: versionOf(text),
    };
  }

  function create(text: string) {
    return serial(async () => {
      const song = validate(text);
      if (await exists(song.slug))
        throw new StoreError(
          409,
          `A song at /${song.slug} exists already. Give this one a different title or slug.`,
        );
      if ((await slugs()).length >= MAX_SONGS)
        throw new StoreError(
          409,
          `The library is full. The limit is ${MAX_SONGS} songs. Archive a song first.`,
        );
      await writeAtomic(songFile(song.slug), text);
      return { slug: song.slug, version: versionOf(text) };
    });
  }

  function update(slug: string, text: string, version?: string) {
    return serial(async () => {
      const current = await readSong(slug);
      if (current === null)
        throw new StoreError(404, `There is no song at /${slug}.`);
      if (version && version !== versionOf(current))
        throw new StoreError(
          409,
          'Someone changed this song after you opened it. Copy your text, reload the page, then make your change again.',
        );
      const song = validate(text);
      if (song.slug !== slug && (await exists(song.slug)))
        throw new StoreError(
          409,
          `A song at /${song.slug} exists already. Use a different slug.`,
        );
      if (text !== current) {
        const dir = join(historyDir, slug);
        await mkdir(dir, { recursive: true });
        await writeAtomic(join(dir, `${stamp()}.txt`), current);
      }
      await writeAtomic(songFile(song.slug), text);
      // A new slug moves the song. The history folder of the old slug
      // keeps the old text.
      if (song.slug !== slug) await unlink(songFile(slug));
      return { slug: song.slug, version: versionOf(text) };
    });
  }

  function archive(slug: string) {
    return serial(async () => {
      if (!(await exists(slug)))
        throw new StoreError(404, `There is no song at /${slug}.`);
      const id = `${slug}--${stamp()}`;
      await rename(songFile(slug), join(archiveDir, `${id}.txt`));
      return { id };
    });
  }

  function restore(id: string) {
    return serial(async () => {
      if (!ARCHIVE_ID_RE.test(id))
        throw new StoreError(404, 'There is no such archived song.');
      const path = join(archiveDir, `${id}.txt`);
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (e) {
        if (isMissing(e))
          throw new StoreError(404, 'There is no such archived song.');
        throw e;
      }
      const song = validate(text);
      if (await exists(song.slug))
        throw new StoreError(
          409,
          `A song at /${song.slug} exists already. Archive it or change its slug, then restore this one.`,
        );
      await rename(path, songFile(song.slug));
      return { slug: song.slug };
    });
  }

  return { init, list, get, create, update, archive, restore };
}

export type Store = ReturnType<typeof createStore>;
